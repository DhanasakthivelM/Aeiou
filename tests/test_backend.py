import asyncio
import os
import unittest
from unittest.mock import patch

from fastapi import HTTPException
import httpx
from pydantic import ValidationError

from main import CartItem, OrderRequest, ProductFields, _slugify, app, create_order


class StoreApiTests(unittest.TestCase):
    def request(self, method, path, **kwargs):
        async def send():
            transport = httpx.ASGITransport(app=app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
                cookies = kwargs.pop("cookies", None)
                if cookies:
                    client.cookies.update(cookies)
                return await client.request(method, path, **kwargs)

        return asyncio.run(send())

    def test_order_uses_server_side_product_ids_and_combines_duplicate_lines(self):
        order = OrderRequest(items=[
            CartItem(product_id="everyday-tote", quantity=2),
            CartItem(product_id="everyday-tote", quantity=3),
            CartItem(product_id="slow-morning-mug", quantity=1),
        ])
        expected = {
            "p_items": [
                {"product_id": "everyday-tote", "quantity": 5},
                {"product_id": "slow-morning-mug", "quantity": 1},
            ]
        }
        with patch("main._supabase_request", return_value={"order_number": "GK-12345678"}) as request:
            result = create_order(order)

        self.assertEqual(result["order_number"], "GK-12345678")
        request.assert_called_once_with("POST", "/rest/v1/rpc/create_store_order", payload=expected)

    def test_order_rejects_combined_quantity_over_limit(self):
        order = OrderRequest(items=[
            CartItem(product_id="everyday-tote", quantity=60),
            CartItem(product_id="everyday-tote", quantity=40),
        ])

        with self.assertRaises(HTTPException) as error:
            create_order(order)

        self.assertEqual(error.exception.status_code, 422)

    def test_order_request_does_not_accept_client_supplied_prices(self):
        with self.assertRaises(ValidationError):
            OrderRequest(items=[{
                "product_id": "everyday-tote",
                "quantity": 1,
                "price": 0.01,
            }])

    def test_product_images_only_allow_http_urls(self):
        with self.assertRaises(ValidationError):
            ProductFields(
                name="Example",
                category="home",
                price="12.00",
                image_url="javascript:alert(1)",
                image_alt="Example image",
            )

    def test_product_slug_is_normalized(self):
        self.assertEqual(_slugify("The Soft Sunday Knit"), "the-soft-sunday-knit")

    def test_admin_routes_require_a_signed_in_allowlisted_user(self):
        response = self.request("GET", "/api/admin/dashboard")

        self.assertEqual(response.status_code, 401)

    def test_non_allowlisted_admin_cannot_sign_in(self):
        environment = {
            "SUPABASE_URL": "https://example.supabase.co",
            "SUPABASE_ANON_KEY": "public-test-key",
            "SUPABASE_SERVICE_ROLE_KEY": "server-test-key",
            "ADMIN_EMAILS": "owner@example.com",
            "COOKIE_SECURE": "false",
        }
        with patch.dict(os.environ, environment), patch("main._supabase_request") as supabase:
            response = self.request(
                "POST",
                "/api/admin/login",
                json={"email": "visitor@example.com", "password": "not-a-real-password"},
            )

        self.assertEqual(response.status_code, 403)
        supabase.assert_not_called()

    def test_admin_login_uses_an_http_only_session_cookie(self):
        environment = {
            "SUPABASE_URL": "https://example.supabase.co",
            "SUPABASE_ANON_KEY": "public-test-key",
            "SUPABASE_SERVICE_ROLE_KEY": "server-test-key",
            "ADMIN_EMAILS": "owner@example.com",
            "COOKIE_SECURE": "false",
        }
        session = {
            "access_token": "short-lived-test-session",
            "expires_in": 3600,
            "user": {"email": "owner@example.com"},
        }
        with patch.dict(os.environ, environment), patch("main._supabase_request", return_value=session):
            response = self.request(
                "POST",
                "/api/admin/login",
                json={"email": "owner@example.com", "password": "test-password"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"email": "owner@example.com"})
        self.assertIn("httponly", response.headers["set-cookie"].lower())
        self.assertNotIn("server-test-key", response.text)

    def test_admin_dashboard_verifies_the_session_and_returns_sales(self):
        environment = {
            "SUPABASE_URL": "https://example.supabase.co",
            "SUPABASE_ANON_KEY": "public-test-key",
            "SUPABASE_SERVICE_ROLE_KEY": "server-test-key",
            "ADMIN_EMAILS": "owner@example.com",
            "COOKIE_SECURE": "false",
        }
        dashboard = {"confirmed_revenue": 320, "confirmed_orders": 4, "pending_orders": 2}

        def supabase_response(method, path, **_kwargs):
            if path == "/auth/v1/user":
                return {"email": "owner@example.com"}
            if path == "/rest/v1/rpc/admin_dashboard_summary":
                return dashboard
            raise AssertionError(f"Unexpected Supabase request: {method} {path}")

        with patch.dict(os.environ, environment), patch("main._supabase_request", side_effect=supabase_response):
            response = self.request(
                "GET",
                "/api/admin/dashboard",
                cookies={"goodkind_admin": "short-lived-test-session"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), dashboard)

    def test_admin_order_status_uses_the_authorized_database_function(self):
        order_id = "7f4b39b0-962c-4c36-a0ec-39a14e3190d3"
        environment = {
            "SUPABASE_URL": "https://example.supabase.co",
            "SUPABASE_ANON_KEY": "public-test-key",
            "SUPABASE_SERVICE_ROLE_KEY": "server-test-key",
            "ADMIN_EMAILS": "owner@example.com",
            "COOKIE_SECURE": "false",
        }
        updated_order = {"id": order_id, "status": "confirmed"}

        def supabase_response(method, path, **_kwargs):
            if path == "/auth/v1/user":
                return {"email": "owner@example.com"}
            if path == "/rest/v1/rpc/admin_update_order_status":
                return updated_order
            raise AssertionError(f"Unexpected Supabase request: {method} {path}")

        with patch.dict(os.environ, environment), patch("main._supabase_request", side_effect=supabase_response) as request:
            response = self.request(
                "PATCH",
                f"/api/admin/orders/{order_id}",
                cookies={"goodkind_admin": "short-lived-test-session"},
                json={"status": "confirmed"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), updated_order)
        self.assertEqual(request.call_args.args, ("POST", "/rest/v1/rpc/admin_update_order_status"))
        self.assertEqual(
            request.call_args.kwargs["payload"],
            {"p_order_id": order_id, "p_status": "confirmed"},
        )

    def test_public_products_are_read_from_the_database(self):
        catalogue = [{"id": "everyday-tote", "name": "The Everyday Tote"}]
        with patch("main._table_request", return_value=catalogue) as table_request:
            response = self.request("GET", "/api/products")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), catalogue)
        table_request.assert_called_once_with(
            "GET",
            "products",
            {"select": "*", "is_active": "eq.true", "order": "sort_order.asc,created_at.desc"},
        )

    def test_brand_assets_are_served_as_pngs(self):
        for asset in ("aeiou-mark.png", "aeiou-logo.png", "aeiou-logo-light.png"):
            with self.subTest(asset=asset):
                response = self.request("GET", f"/assets/{asset}")

                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.headers["content-type"], "image/png")
                self.assertTrue(response.content.startswith(b"\x89PNG\r\n\x1a\n"))

    def test_store_config_uses_aeiou_as_the_default_name(self):
        with patch.dict(os.environ, {"STORE_NAME": "", "WHATSAPP_NUMBER": ""}):
            response = self.request("GET", "/api/config")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["store_name"], "Aeiou")


if __name__ == "__main__":
    unittest.main()
