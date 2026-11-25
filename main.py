from __future__ import annotations

import json
import os
import re
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
import uuid
from decimal import Decimal
from pathlib import Path
from typing import Annotated, Literal

from dotenv import load_dotenv
from fastapi import Cookie, Depends, FastAPI, HTTPException, Request, Response
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator

ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / ".env")

app = FastAPI(
    title="Aeiou Store API",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)


class SupabaseError(Exception):
    def __init__(self, status_code: int, detail: str):
        self.status_code = status_code
        self.detail = detail
        super().__init__(detail)


class ProductFields(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=120)
    category: Literal["wear", "home", "accessories", "wellness"]
    description: str = Field(default="", max_length=2000)
    price: Decimal = Field(gt=0, max_digits=10, decimal_places=2)
    label: str = Field(default="", max_length=40)
    trending: bool = False
    image_url: str = Field(min_length=1, max_length=2048)
    image_alt: str = Field(min_length=1, max_length=240)
    stock_quantity: int | None = Field(default=None, ge=0, le=1_000_000)
    is_active: bool = True
    sort_order: int = Field(default=100, ge=0, le=100_000)

    @field_validator("image_url")
    @classmethod
    def validate_image_url(cls, value: str) -> str:
        if urllib.parse.urlsplit(value).scheme not in {"https", "http"}:
            raise ValueError("Image URLs must use HTTP or HTTPS.")
        return value


class ProductPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=120)
    category: Literal["wear", "home", "accessories", "wellness"] | None = None
    description: str | None = Field(default=None, max_length=2000)
    price: Decimal | None = Field(default=None, gt=0, max_digits=10, decimal_places=2)
    label: str | None = Field(default=None, max_length=40)
    trending: bool | None = None
    image_url: str | None = Field(default=None, min_length=1, max_length=2048)
    image_alt: str | None = Field(default=None, min_length=1, max_length=240)
    stock_quantity: int | None = Field(default=None, ge=0, le=1_000_000)
    is_active: bool | None = None
    sort_order: int | None = Field(default=None, ge=0, le=100_000)

    @field_validator("image_url")
    @classmethod
    def validate_image_url(cls, value: str | None) -> str | None:
        if value is not None and urllib.parse.urlsplit(value).scheme not in {"https", "http"}:
            raise ValueError("Image URLs must use HTTP or HTTPS.")
        return value


class BannerFields(BaseModel):
    model_config = ConfigDict(extra="forbid")

    eyebrow: str = Field(min_length=1, max_length=80)
    headline: str = Field(min_length=1, max_length=160)
    description: str = Field(default="", max_length=400)
    button_label: str = Field(min_length=1, max_length=60)
    category: Literal["all", "wear", "home", "accessories", "wellness"]
    image_url: str = Field(min_length=1, max_length=2048)
    image_alt: str = Field(min_length=1, max_length=240)
    sort_order: int = Field(default=100, ge=0, le=100_000)
    is_active: bool = True

    @field_validator("image_url")
    @classmethod
    def validate_image_url(cls, value: str) -> str:
        if urllib.parse.urlsplit(value).scheme not in {"https", "http"}:
            raise ValueError("Image URLs must use HTTP or HTTPS.")
        return value


class BannerPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    eyebrow: str | None = Field(default=None, min_length=1, max_length=80)
    headline: str | None = Field(default=None, min_length=1, max_length=160)
    description: str | None = Field(default=None, max_length=400)
    button_label: str | None = Field(default=None, min_length=1, max_length=60)
    category: Literal["all", "wear", "home", "accessories", "wellness"] | None = None
    image_url: str | None = Field(default=None, min_length=1, max_length=2048)
    image_alt: str | None = Field(default=None, min_length=1, max_length=240)
    sort_order: int | None = Field(default=None, ge=0, le=100_000)
    is_active: bool | None = None

    @field_validator("image_url")
    @classmethod
    def validate_image_url(cls, value: str | None) -> str | None:
        if value is not None and urllib.parse.urlsplit(value).scheme not in {"https", "http"}:
            raise ValueError("Image URLs must use HTTP or HTTPS.")
        return value


class CartItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    product_id: str = Field(min_length=1, max_length=80)
    quantity: int = Field(ge=1, le=99)


class OrderRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: list[CartItem] = Field(min_length=1, max_length=50)


class OrderStatusPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["pending", "confirmed", "completed", "cancelled"]


class AdminCredentials(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=256)


def _settings() -> tuple[str, str, str]:
    url = os.getenv("SUPABASE_URL", "").strip().rstrip("/")
    anon_key = os.getenv("SUPABASE_ANON_KEY", "").strip()
    service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    if not url or not anon_key or not service_key:
        raise HTTPException(
            status_code=503,
            detail="The store database is not configured. Add the Supabase environment variables.",
        )
    return url, anon_key, service_key


def _admin_emails() -> set[str]:
    return {
        email.strip().lower()
        for email in os.getenv("ADMIN_EMAILS", "").split(",")
        if email.strip()
    }


def _supabase_request(
    method: str,
    path: str,
    *,
    payload: object | None = None,
    access_token: str | None = None,
    use_anon_key: bool = False,
    extra_headers: dict[str, str] | None = None,
) -> object:
    url, anon_key, service_key = _settings()
    key = anon_key if use_anon_key else service_key
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {access_token or key}",
        "Accept": "application/json",
    }
    data = None
    if payload is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(payload, separators=(",", ":"), default=str).encode("utf-8")
    if extra_headers:
        headers.update(extra_headers)

    request = urllib.request.Request(
        f"{url}{path}",
        data=data,
        headers=headers,
        method=method,
    )
    try:
        with urllib.request.urlopen(request, timeout=12) as result:
            response_body = result.read()
            return json.loads(response_body) if response_body else None
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        try:
            parsed = json.loads(detail)
            detail = str(parsed.get("message") or parsed.get("msg") or parsed.get("error_description") or detail)
        except (json.JSONDecodeError, AttributeError):
            pass
        raise SupabaseError(error.code, detail[:500]) from error
    except (urllib.error.URLError, TimeoutError) as error:
        raise HTTPException(
            status_code=502,
            detail="Could not reach Supabase. Check the project URL and try again.",
        ) from error


def _table_request(method: str, table: str, params: dict[str, str], payload: object | None = None):
    query = urllib.parse.urlencode(params, safe="(),.*:")
    headers = {"Prefer": "return=representation"} if method in {"POST", "PATCH"} else None
    return _supabase_request(
        method,
        f"/rest/v1/{table}?{query}",
        payload=payload,
        extra_headers=headers,
    )


def _require_admin(
    session_token: Annotated[str | None, Cookie(alias="goodkind_admin")] = None,
) -> str:
    if not session_token:
        raise HTTPException(status_code=401, detail="Please sign in to the admin dashboard.")
    allowed_emails = _admin_emails()
    if not allowed_emails:
        raise HTTPException(
            status_code=503,
            detail="No admin email is configured. Set ADMIN_EMAILS on the server.",
        )
    try:
        user = _supabase_request(
            "GET",
            "/auth/v1/user",
            access_token=session_token,
            use_anon_key=True,
        )
    except SupabaseError as error:
        raise HTTPException(status_code=401, detail="Your admin session has expired. Please sign in again.") from error
    if not isinstance(user, dict):
        raise HTTPException(status_code=401, detail="Could not verify the admin session.")
    email = str(user.get("email", "")).lower()
    if email not in allowed_emails:
        raise HTTPException(status_code=403, detail="This account is not permitted to manage the store.")
    return email


Admin = Annotated[str, Depends(_require_admin)]


def _raise_supabase_error(error: SupabaseError) -> None:
    status_code = error.status_code if 400 <= error.status_code < 500 else 502
    raise HTTPException(status_code=status_code, detail=error.detail) from error


def _slugify(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^a-z0-9]+", "-", normalized.lower()).strip("-")
    return slug[:60].strip("-") or uuid.uuid4().hex[:12]


@app.get("/api/health")
def health():
    configured = all(
        os.getenv(name, "").strip()
        for name in ("SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY")
    )
    return {
        "status": "ok",
        "database_configured": configured,
        "admin_configured": bool(_admin_emails()),
    }


@app.get("/api/config")
def public_config():
    whatsapp_number = re.sub(r"\D", "", os.getenv("WHATSAPP_NUMBER", ""))
    return {
        "store_name": os.getenv("STORE_NAME", "Aeiou").strip() or "Aeiou",
        "whatsapp_number": whatsapp_number,
        "currency": "USD",
    }


@app.get("/api/products")
def get_products():
    try:
        result = _table_request(
            "GET",
            "products",
            {"select": "*", "is_active": "eq.true", "order": "sort_order.asc,created_at.desc"},
        )
        return result
    except SupabaseError as error:
        _raise_supabase_error(error)


@app.get("/api/banners")
def get_banners():
    try:
        result = _table_request(
            "GET",
            "banners",
            {"select": "*", "is_active": "eq.true", "order": "sort_order.asc,created_at.asc"},
        )
        return result
    except SupabaseError as error:
        _raise_supabase_error(error)


@app.post("/api/orders", status_code=201)
def create_order(order: OrderRequest):
    quantities: dict[str, int] = {}
    for item in order.items:
        quantities[item.product_id] = quantities.get(item.product_id, 0) + item.quantity
    if any(quantity > 99 for quantity in quantities.values()):
        raise HTTPException(status_code=422, detail="The maximum quantity of one product per order is 99.")
    try:
        result = _supabase_request(
            "POST",
            "/rest/v1/rpc/create_store_order",
            payload={"p_items": [{"product_id": key, "quantity": value} for key, value in quantities.items()]},
        )
        return result
    except SupabaseError as error:
        _raise_supabase_error(error)


@app.post("/api/admin/login")
def admin_login(response: Response, credentials: AdminCredentials):
    email = credentials.email.strip().lower()
    password = credentials.password
    allowed_emails = _admin_emails()
    if not allowed_emails:
        raise HTTPException(status_code=503, detail="Set ADMIN_EMAILS on the server before signing in.")
    if email not in allowed_emails:
        raise HTTPException(status_code=403, detail="This account is not permitted to manage the store.")
    try:
        result = _supabase_request(
            "POST",
            "/auth/v1/token?grant_type=password",
            payload={"email": email, "password": password},
            use_anon_key=True,
        )
    except SupabaseError as error:
        if error.status_code in (400, 401):
            raise HTTPException(status_code=401, detail="Email or password is incorrect.") from error
        _raise_supabase_error(error)
    if not isinstance(result, dict) or not result.get("access_token"):
        raise HTTPException(status_code=502, detail="Supabase did not return an admin session.")

    is_secure = os.getenv("COOKIE_SECURE", "").lower() == "true" or os.getenv("VERCEL") == "1"
    response.set_cookie(
        "goodkind_admin",
        str(result["access_token"]),
        httponly=True,
        secure=is_secure,
        samesite="strict",
        max_age=max(60, int(result.get("expires_in", 3600))),
        path="/",
    )
    user = result.get("user") or {}
    return {"email": user.get("email", email)}


@app.post("/api/admin/logout")
def admin_logout(response: Response, _admin: Admin, session_token: Annotated[str | None, Cookie(alias="goodkind_admin")] = None):
    if session_token:
        try:
            _supabase_request("POST", "/auth/v1/logout", access_token=session_token, use_anon_key=True)
        except SupabaseError as error:
            raise HTTPException(status_code=502, detail="Could not safely revoke the admin session. Please try again.") from error
    response.delete_cookie("goodkind_admin", path="/", httponly=True, samesite="strict")
    return {"ok": True}


@app.get("/api/admin/me")
def admin_me(admin: Admin):
    return {"email": admin}


@app.get("/api/admin/dashboard")
def admin_dashboard(_admin: Admin):
    try:
        return _supabase_request("POST", "/rest/v1/rpc/admin_dashboard_summary", payload={})
    except SupabaseError as error:
        _raise_supabase_error(error)


@app.get("/api/admin/products")
def admin_products(_admin: Admin):
    try:
        return _table_request(
            "GET",
            "products",
            {"select": "*", "order": "sort_order.asc,created_at.desc", "limit": "500"},
        )
    except SupabaseError as error:
        _raise_supabase_error(error)


@app.post("/api/admin/products", status_code=201)
def add_product(product: ProductFields, _admin: Admin):
    record = product.model_dump(mode="json")
    record["id"] = _slugify(product.name)
    try:
        result = _table_request(
            "POST",
            "products",
            {"select": "*"},
            {**record, "slug": record["id"]},
        )
        return result
    except SupabaseError as error:
        _raise_supabase_error(error)


@app.patch("/api/admin/products/{product_id}")
def update_product(product_id: str, patch: ProductPatch, _admin: Admin):
    changes = patch.model_dump(mode="json", exclude_unset=True)
    if not changes:
        raise HTTPException(status_code=422, detail="Choose at least one product field to update.")
    try:
        result = _table_request(
            "PATCH",
            "products",
            {"id": f"eq.{product_id}", "select": "*"},
            changes,
        )
        if not result:
            raise HTTPException(status_code=404, detail="Product not found.")
        return result[0]
    except SupabaseError as error:
        _raise_supabase_error(error)


@app.delete("/api/admin/products/{product_id}", status_code=204)
def delete_product(product_id: str, _admin: Admin):
    try:
        result = _table_request(
            "PATCH",
            "products",
            {"id": f"eq.{product_id}", "select": "id"},
            {"is_active": False},
        )
        if not result:
            raise HTTPException(status_code=404, detail="Product not found.")
        return Response(status_code=204)
    except SupabaseError as error:
        _raise_supabase_error(error)


@app.get("/api/admin/banners")
def admin_banners(_admin: Admin):
    try:
        return _table_request(
            "GET",
            "banners",
            {"select": "*", "order": "sort_order.asc,created_at.asc", "limit": "100"},
        )
    except SupabaseError as error:
        _raise_supabase_error(error)


@app.post("/api/admin/banners", status_code=201)
def add_banner(banner: BannerFields, _admin: Admin):
    try:
        result = _table_request("POST", "banners", {"select": "*"}, banner.model_dump(mode="json"))
        return result
    except SupabaseError as error:
        _raise_supabase_error(error)


@app.patch("/api/admin/banners/{banner_id}")
def update_banner(banner_id: str, patch: BannerPatch, _admin: Admin):
    changes = patch.model_dump(mode="json", exclude_unset=True)
    if not changes:
        raise HTTPException(status_code=422, detail="Choose at least one banner field to update.")
    try:
        result = _table_request(
            "PATCH",
            "banners",
            {"id": f"eq.{banner_id}", "select": "*"},
            changes,
        )
        if not result:
            raise HTTPException(status_code=404, detail="Banner not found.")
        return result[0]
    except SupabaseError as error:
        _raise_supabase_error(error)


@app.delete("/api/admin/banners/{banner_id}", status_code=204)
def delete_banner(banner_id: str, _admin: Admin):
    try:
        result = _table_request(
            "PATCH",
            "banners",
            {"id": f"eq.{banner_id}", "select": "id"},
            {"is_active": False},
        )
        if not result:
            raise HTTPException(status_code=404, detail="Banner not found.")
        return Response(status_code=204)
    except SupabaseError as error:
        _raise_supabase_error(error)


@app.get("/api/admin/orders")
def admin_orders(_admin: Admin):
    try:
        return _table_request(
            "GET",
            "orders",
            {
                "select": "*,order_items(*)",
                "order": "created_at.desc",
                "limit": "200",
            },
        )
    except SupabaseError as error:
        _raise_supabase_error(error)


@app.patch("/api/admin/orders/{order_id}")
def update_order_status(order_id: uuid.UUID, patch: OrderStatusPatch, _admin: Admin):
    try:
        result = _supabase_request(
            "POST",
            "/rest/v1/rpc/admin_update_order_status",
            payload={"p_order_id": str(order_id), "p_status": patch.status},
        )
        if result is None:
            raise HTTPException(status_code=404, detail="Order not found.")
        return result
    except SupabaseError as error:
        _raise_supabase_error(error)


@app.post("/api/admin/media", status_code=201)
async def upload_media(request: Request, _admin: Admin):
    content_type = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
    extensions = {
        "image/jpeg": ".jpg",
        "image/png": ".png",
        "image/webp": ".webp",
        "image/gif": ".gif",
    }
    extension = extensions.get(content_type)
    if not extension:
        raise HTTPException(status_code=415, detail="Choose a JPEG, PNG, WebP, or GIF image.")

    image = await request.body()
    if not image or len(image) > 5 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Images must be smaller than 5 MB.")
    valid_signatures = {
        ".jpg": image.startswith(b"\xff\xd8\xff"),
        ".png": image.startswith(b"\x89PNG\r\n\x1a\n"),
        ".webp": image.startswith(b"RIFF") and image[8:12] == b"WEBP",
        ".gif": image.startswith((b"GIF87a", b"GIF89a")),
    }
    if not valid_signatures[extension]:
        raise HTTPException(status_code=415, detail="The image contents do not match the selected image type.")

    url, _anon_key, service_key = _settings()
    bucket = os.getenv("SUPABASE_STORAGE_BUCKET", "storefront-media").strip()
    file_path = f"store/{uuid.uuid4().hex}{extension}"
    headers = {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Content-Type": content_type,
        "x-upsert": "false",
    }
    upload_request = urllib.request.Request(
        f"{url}/storage/v1/object/{urllib.parse.quote(bucket, safe='')}/{urllib.parse.quote(file_path, safe='/')}",
        data=image,
        headers=headers,
        method="POST",
    )
    try:
        with urllib.request.urlopen(upload_request, timeout=20) as result:
            result.read()
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise HTTPException(status_code=502, detail=f"Supabase Storage could not save the image: {detail[:300]}") from error
    except (urllib.error.URLError, TimeoutError) as error:
        raise HTTPException(status_code=502, detail="Could not reach Supabase Storage.") from error

    return {
        "image_url": f"{url}/storage/v1/object/public/{urllib.parse.quote(bucket, safe='')}/{urllib.parse.quote(file_path, safe='/')}",
        "image_alt": "",
    }


@app.get("/admin", include_in_schema=False)
@app.get("/admin/", include_in_schema=False)
def admin_page():
    return FileResponse(ROOT / "admin.html")


@app.get("/assets/{asset_name}", include_in_schema=False)
def brand_asset(asset_name: Literal["aeiou-mark.png", "aeiou-logo.png", "aeiou-logo-light.png"]):
    return FileResponse(ROOT / "assets" / asset_name, media_type="image/png")


@app.get("/", include_in_schema=False)
def storefront_page():
    return FileResponse(ROOT / "index.html")


@app.get("/styles.css", include_in_schema=False)
def storefront_styles():
    return FileResponse(ROOT / "styles.css", media_type="text/css")


@app.get("/app.js", include_in_schema=False)
def storefront_script():
    return FileResponse(ROOT / "app.js", media_type="text/javascript")


@app.get("/admin.css", include_in_schema=False)
def admin_styles():
    return FileResponse(ROOT / "admin.css", media_type="text/css")


@app.get("/admin.js", include_in_schema=False)
def admin_script():
    return FileResponse(ROOT / "admin.js", media_type="text/javascript")
