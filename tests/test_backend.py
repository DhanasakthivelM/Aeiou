import unittest
from unittest.mock import patch

from fastapi import HTTPException
from pydantic import ValidationError

from main import CartItem, OrderRequest, ProductFields, _slugify, create_order


class StoreApiTests(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
