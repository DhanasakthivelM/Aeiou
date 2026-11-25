const state = {
  products: [],
  banners: [],
  orders: [],
  dashboard: null,
  panel: "overview",
  toastTimer: null,
};

const sections = [...document.querySelectorAll("[data-section]")];
const titleByPanel = {
  overview: "A lovely overview",
  orders: "Orders, with care",
  products: "Your collection",
  banners: "Your home page",
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function money(value) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(value || 0));
}

function dateLabel(value) {
  return new Date(value).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(path, {
      ...options,
      credentials: "same-origin",
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
    });
  } catch (error) {
    console.error(`Store admin request failed for ${path}.`, error);
    throw new Error("Could not reach the store server. Check your connection and try again.");
  }
  if (response.status === 204) return null;
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof result.detail === "string" ? result.detail : "The request could not be completed.";
    if (response.status === 401 && path !== "/api/admin/login") showLogin(message);
    throw new Error(message);
  }
  return result;
}

function showLogin(message = "") {
  document.querySelector("#login-screen").hidden = false;
  document.querySelector("#admin-app").hidden = true;
  const error = document.querySelector("#login-error");
  error.textContent = message;
  error.hidden = !message;
}

function showAdmin(email) {
  document.querySelector("#login-screen").hidden = true;
  document.querySelector("#admin-app").hidden = false;
  document.querySelector("#admin-email").textContent = email;
  document.querySelector("#today-label").textContent = new Date().toLocaleDateString(undefined, {
    weekday: "long", month: "long", day: "numeric",
  });
  switchPanel(state.panel);
}

function showToast(message) {
  const toast = document.querySelector("#admin-toast");
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.clearTimeout(state.toastTimer);
  state.toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 3200);
}

function switchPanel(name) {
  if (!titleByPanel[name]) return;
  state.panel = name;
  sections.forEach((section) => {
    const active = section.dataset.section === name;
    section.hidden = !active;
    section.classList.toggle("is-current", active);
  });
  document.querySelector("#page-title").textContent = titleByPanel[name];
  document.querySelectorAll("[data-panel]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.panel === name);
  });
  if (name === "orders") renderOrders();
  if (name === "products") renderProducts();
  if (name === "banners") renderBanners();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderChart(days = []) {
  const chart = document.querySelector("#sales-chart");
  if (!days.length) {
    chart.innerHTML = '<p class="chart-empty">Your sales will appear here once orders are confirmed.</p>';
    return;
  }
  const maxRevenue = Math.max(1, ...days.map((day) => Number(day.revenue || 0)));
  chart.innerHTML = days.map((day) => {
    const date = new Date(`${day.day}T12:00:00`);
    const label = date.toLocaleDateString(undefined, { weekday: "short" });
    const value = Number(day.revenue || 0);
    const height = value ? Math.max(5, (value / maxRevenue) * 100) : 2;
    return `
      <div class="chart-day" title="${escapeHtml(label)}: ${escapeHtml(money(value))}">
        <div class="chart-track"><div class="chart-bar" style="height:${height}%"></div></div>
        <span>${escapeHtml(label)}</span>
      </div>
    `;
  }).join("");
}

function orderItemsSummary(items = []) {
  return items.map((item) => `${item.quantity} × ${item.product_name}`).join(" · ") || "No item details";
}

function renderRecentOrders(orders = []) {
  const container = document.querySelector("#recent-orders");
  if (!orders.length) {
    container.innerHTML = '<div class="empty-state">Your first order will be waiting here.</div>';
    return;
  }
  container.innerHTML = orders.slice(0, 5).map((order) => `
    <article class="admin-order-card">
      <div class="admin-order-primary"><strong>${escapeHtml(order.order_number)}</strong><small>${escapeHtml(dateLabel(order.created_at))}</small></div>
      <div class="admin-order-summary"><span>${escapeHtml(orderItemsSummary(order.order_items))}</span><small>${escapeHtml(order.status)}</small></div>
      <span class="admin-order-total">${escapeHtml(money(order.total))}</span>
      <span class="status-label" data-status="${escapeHtml(order.status)}">${escapeHtml(order.status)}</span>
    </article>
  `).join("");
}

async function loadDashboard() {
  const [dashboard, products] = await Promise.all([
    api("/api/admin/dashboard"),
    api("/api/admin/products"),
  ]);
  state.dashboard = dashboard;
  state.products = products;
  document.querySelector("#metric-revenue").textContent = money(dashboard.confirmed_revenue);
  document.querySelector("#metric-confirmed").textContent = String(dashboard.confirmed_orders || 0);
  document.querySelector("#metric-pending").textContent = String(dashboard.pending_orders || 0);
  document.querySelector("#metric-products").textContent = String(dashboard.active_products || 0);
  document.querySelector("#pending-count").textContent = String(dashboard.pending_orders || 0);
  renderChart(dashboard.weekly_sales || []);
  renderRecentOrders(dashboard.recent_orders || []);
}

function renderProducts() {
  const search = document.querySelector("#product-search").value.trim().toLowerCase();
  const products = state.products.filter((product) => `${product.name} ${product.category}`.toLowerCase().includes(search));
  document.querySelector("#product-count").textContent = `${products.length} ${products.length === 1 ? "product" : "products"}`;
  const container = document.querySelector("#products-grid");
  if (!products.length) {
    container.innerHTML = '<p class="empty-collection">No products match that search.</p>';
    return;
  }
  container.innerHTML = products.map((product) => `
    <article class="product-admin-card">
      <img src="${escapeHtml(product.image_url)}" alt="${escapeHtml(product.image_alt)}" loading="lazy" />
      <div class="product-admin-info">
        <div class="product-admin-title"><h3>${escapeHtml(product.name)}</h3><strong>${escapeHtml(money(product.price))}</strong></div>
        <p class="product-admin-meta">${escapeHtml(product.category)} · ${product.is_active ? "Available" : "Hidden"}${product.stock_quantity === null ? "" : ` · ${product.stock_quantity} in stock`}</p>
        <div class="product-card-actions">
          <button type="button" class="small-action" data-action="edit-product" data-id="${escapeHtml(product.id)}">Edit</button>
          <button type="button" class="small-action is-danger" data-action="delete-product" data-id="${escapeHtml(product.id)}">${product.is_active ? "Remove" : "Delete"}</button>
        </div>
      </div>
    </article>
  `).join("");
}

function renderBanners() {
  const container = document.querySelector("#banners-list");
  if (!state.banners.length) {
    container.innerHTML = '<p class="empty-collection">No banners yet. Add one to welcome customers to your shop.</p>';
    return;
  }
  container.innerHTML = state.banners.map((banner) => `
    <article class="banner-admin-card">
      <img src="${escapeHtml(banner.image_url)}" alt="${escapeHtml(banner.image_alt)}" loading="lazy" />
      <div class="banner-copy">
        <span class="eyebrow">${escapeHtml(banner.eyebrow)}</span>
        <h3>${escapeHtml(banner.headline)}</h3>
        <p>${escapeHtml(banner.description)}</p>
        <span class="banner-status${banner.is_active ? "" : " is-hidden"}">${banner.is_active ? "Shown on storefront" : "Hidden from storefront"}</span>
      </div>
      <div class="banner-actions">
        <button type="button" class="small-action" data-action="edit-banner" data-id="${escapeHtml(banner.id)}">Edit</button>
        <button type="button" class="small-action is-danger" data-action="delete-banner" data-id="${escapeHtml(banner.id)}">Remove</button>
      </div>
    </article>
  `).join("");
}

function renderOrders() {
  const container = document.querySelector("#orders-list");
  if (!state.orders.length) {
    container.innerHTML = '<div class="empty-state">There are no orders just yet. WhatsApp checkouts will appear here.</div>';
    return;
  }
  container.innerHTML = state.orders.map((order) => `
    <article class="admin-order-card">
      <div class="admin-order-primary"><strong>${escapeHtml(order.order_number)}</strong><small>${escapeHtml(dateLabel(order.created_at))}</small></div>
      <div class="admin-order-summary"><span>${escapeHtml(orderItemsSummary(order.order_items))}</span><small>${escapeHtml(order.order_items.length)} ${order.order_items.length === 1 ? "item" : "items"}</small></div>
      <span class="admin-order-total">${escapeHtml(money(order.total))}</span>
      <label class="admin-order-status"><span class="status-label" data-status="${escapeHtml(order.status)}">${escapeHtml(order.status)}</span>
        <select class="order-status-select" data-action="order-status" data-id="${escapeHtml(order.id)}" aria-label="Update status for ${escapeHtml(order.order_number)}">
          ${["pending", "confirmed", "completed", "cancelled"].map((status) => `<option value="${status}"${status === order.status ? " selected" : ""}>${status[0].toUpperCase()}${status.slice(1)}</option>`).join("")}
        </select>
      </label>
    </article>
  `).join("");
}

function resetForm(form) {
  form.reset();
  form.elements.id.value = "";
  form.elements.image_url.value = "";
  const preview = form.querySelector(".form-image-preview");
  preview.removeAttribute("src");
  preview.hidden = true;
}

function showDialog(dialogId) {
  const dialog = document.querySelector(dialogId);
  if (!dialog.open) dialog.showModal();
  document.body.classList.add("no-scroll");
}

function closeDialog(dialog) {
  if (dialog.open) dialog.close();
  if (!document.querySelector("dialog[open]")) document.body.classList.remove("no-scroll");
}

function openProductEditor(product = null) {
  const form = document.querySelector("#product-form");
  resetForm(form);
  document.querySelector("#product-form-error").hidden = true;
  document.querySelector("#product-dialog-title").textContent = product ? "Edit product" : "Add a product";
  if (product) {
    Object.entries(product).forEach(([key, value]) => {
      const field = form.elements.namedItem(key);
      if (!field) return;
      if (field.type === "checkbox") field.checked = Boolean(value);
      else if (key === "stock_quantity") field.value = value ?? "";
      else if (field.type !== "file") field.value = value ?? "";
    });
    const preview = document.querySelector("#product-image-preview");
    preview.src = product.image_url;
    preview.alt = product.image_alt;
    preview.hidden = false;
  } else {
    form.elements.is_active.checked = true;
    form.elements.sort_order.value = "100";
  }
  showDialog("#product-dialog");
}

function openBannerEditor(banner = null) {
  const form = document.querySelector("#banner-form");
  resetForm(form);
  document.querySelector("#banner-form-error").hidden = true;
  document.querySelector("#banner-dialog-title").textContent = banner ? "Edit banner" : "Add a banner";
  if (banner) {
    Object.entries(banner).forEach(([key, value]) => {
      const field = form.elements.namedItem(key);
      if (!field) return;
      if (field.type === "checkbox") field.checked = Boolean(value);
      else if (field.type !== "file") field.value = value ?? "";
    });
    const preview = document.querySelector("#banner-image-preview");
    preview.src = banner.image_url;
    preview.alt = banner.image_alt;
    preview.hidden = false;
  } else {
    form.elements.is_active.checked = true;
    form.elements.category.value = "all";
    form.elements.sort_order.value = "100";
  }
  showDialog("#banner-dialog");
}

async function uploadImage(file) {
  if (!file) return null;
  const response = await fetch("/api/admin/media", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": file.type },
    body: file,
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.detail || "The image could not be uploaded.");
  return result.image_url;
}

function productPayload(form) {
  const data = new FormData(form);
  const stock = data.get("stock_quantity");
  return {
    name: data.get("name").trim(),
    category: data.get("category"),
    description: data.get("description").trim(),
    price: Number(data.get("price")),
    label: data.get("label").trim(),
    trending: data.has("trending"),
    image_url: data.get("image_url"),
    image_alt: data.get("image_alt").trim(),
    stock_quantity: stock === "" ? null : Number(stock),
    is_active: data.has("is_active"),
    sort_order: Number(data.get("sort_order") || 100),
  };
}

function bannerPayload(form) {
  const data = new FormData(form);
  return {
    eyebrow: data.get("eyebrow").trim(),
    headline: data.get("headline").trim(),
    description: data.get("description").trim(),
    button_label: data.get("button_label").trim(),
    category: data.get("category"),
    image_url: data.get("image_url"),
    image_alt: data.get("image_alt").trim(),
    sort_order: Number(data.get("sort_order") || 100),
    is_active: data.has("is_active"),
  };
}

async function saveEditor(form, type) {
  const isProduct = type === "product";
  const error = document.querySelector(isProduct ? "#product-form-error" : "#banner-form-error");
  const submit = form.querySelector('[type="submit"]');
  error.hidden = true;
  submit.disabled = true;
  submit.textContent = "Saving…";
  try {
    const id = form.elements.id.value;
    const file = form.elements.image.files[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) throw new Error("Choose an image smaller than 5 MB.");
      const uploaded = await uploadImage(file);
      form.elements.image_url.value = uploaded;
    }
    if (!form.elements.image_url.value) throw new Error("Choose an image before saving.");
    const payload = isProduct ? productPayload(form) : bannerPayload(form);
    await api(`/api/admin/${isProduct ? "products" : "banners"}${id ? `/${encodeURIComponent(id)}` : ""}`, {
      method: id ? "PATCH" : "POST",
      body: JSON.stringify(payload),
    });
    closeDialog(form.closest("dialog"));
    await loadAllData();
    showToast(isProduct ? "Product saved with care." : "Banner saved and ready.");
  } catch (saveError) {
    error.textContent = saveError.message;
    error.hidden = false;
  } finally {
    submit.disabled = false;
    submit.textContent = isProduct ? "Save product" : "Save banner";
  }
}

async function loadAllData() {
  const [dashboard, products, banners, orders] = await Promise.all([
    api("/api/admin/dashboard"),
    api("/api/admin/products"),
    api("/api/admin/banners"),
    api("/api/admin/orders"),
  ]);
  state.dashboard = dashboard;
  state.products = products;
  state.banners = banners;
  state.orders = orders;
  document.querySelector("#metric-revenue").textContent = money(dashboard.confirmed_revenue);
  document.querySelector("#metric-confirmed").textContent = String(dashboard.confirmed_orders || 0);
  document.querySelector("#metric-pending").textContent = String(dashboard.pending_orders || 0);
  document.querySelector("#metric-products").textContent = String(dashboard.active_products || 0);
  document.querySelector("#pending-count").textContent = String(dashboard.pending_orders || 0);
  renderChart(dashboard.weekly_sales || []);
  renderRecentOrders(dashboard.recent_orders || []);
  renderProducts();
  renderBanners();
  renderOrders();
}

document.querySelector("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const error = document.querySelector("#login-error");
  const button = form.querySelector('[type="submit"]');
  const data = new FormData(form);
  error.hidden = true;
  button.disabled = true;
  button.textContent = "Signing in…";
  try {
    const result = await api("/api/admin/login", {
      method: "POST",
      body: JSON.stringify({ email: data.get("email"), password: data.get("password") }),
    });
    showAdmin(result.email);
  } catch (loginError) {
    error.textContent = loginError.message;
    error.hidden = false;
    return;
  } finally {
    button.disabled = false;
    button.innerHTML = 'Sign in <span aria-hidden="true">→</span>';
    form.elements.password.value = "";
  }
  try {
    await loadAllData();
  } catch (loadError) {
    showToast(loadError.message);
  }
});

document.querySelector("#product-form").addEventListener("submit", (event) => {
  event.preventDefault();
  saveEditor(event.currentTarget, "product");
});

document.querySelector("#banner-form").addEventListener("submit", (event) => {
  event.preventDefault();
  saveEditor(event.currentTarget, "banner");
});

document.querySelector("#product-search").addEventListener("input", renderProducts);

document.addEventListener("change", async (event) => {
  if (event.target.matches('[data-action="order-status"]')) {
    const select = event.target;
    const previous = state.orders.find((order) => order.id === select.dataset.id)?.status;
    select.disabled = true;
    try {
      await api(`/api/admin/orders/${encodeURIComponent(select.dataset.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ status: select.value }),
      });
      await loadAllData();
      showToast("Order status updated.");
    } catch (error) {
      if (previous) select.value = previous;
      showToast(error.message);
    } finally {
      select.disabled = false;
    }
  }
  if (event.target.matches('input[type="file"]')) {
    const input = event.target;
    const file = input.files[0];
    const preview = input.form.querySelector(".form-image-preview");
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      input.value = "";
      showToast("Choose an image smaller than 5 MB.");
      return;
    }
    preview.src = URL.createObjectURL(file);
    preview.alt = "Selected image preview";
    preview.hidden = false;
  }
});

document.addEventListener("click", async (event) => {
  const trigger = event.target.closest("[data-action], [data-panel]");
  if (!trigger) return;

  if (trigger.dataset.panel) {
    event.preventDefault();
    switchPanel(trigger.dataset.panel);
    return;
  }

  const { action, id } = trigger.dataset;
  if (action === "navigate") switchPanel(trigger.dataset.panel);
  if (action === "quick-add-product" || action === "add-product") openProductEditor();
  if (action === "add-banner") openBannerEditor();
  if (action === "close-dialog") closeDialog(trigger.closest("dialog"));
  if (action === "edit-product") openProductEditor(state.products.find((product) => product.id === id));
  if (action === "edit-banner") openBannerEditor(state.banners.find((banner) => banner.id === id));
  if (action === "delete-product") {
    const product = state.products.find((item) => item.id === id);
    if (product && window.confirm(`Remove "${product.name}" from the storefront? Existing order records will stay intact.`)) {
      try {
        await api(`/api/admin/products/${encodeURIComponent(id)}`, { method: "DELETE" });
        await loadAllData();
        showToast("Product removed from the storefront.");
      } catch (error) {
        showToast(error.message);
      }
    }
  }
  if (action === "delete-banner") {
    const banner = state.banners.find((item) => item.id === id);
    if (banner && window.confirm("Remove this banner from the storefront?")) {
      try {
        await api(`/api/admin/banners/${encodeURIComponent(id)}`, { method: "DELETE" });
        await loadAllData();
        showToast("Banner removed from the storefront.");
      } catch (error) {
        showToast(error.message);
      }
    }
  }
  if (action === "logout") {
    trigger.disabled = true;
    try {
      await api("/api/admin/logout", { method: "POST" });
      showLogin();
      document.querySelector("#login-form").reset();
    } catch (error) {
      showToast(error.message);
    } finally {
      trigger.disabled = false;
    }
  }
});

document.querySelectorAll("dialog").forEach((dialog) => {
  dialog.addEventListener("close", () => {
    if (!document.querySelector("dialog[open]")) document.body.classList.remove("no-scroll");
  });
});

async function startAdmin() {
  let admin;
  try {
    admin = await api("/api/admin/me");
  } catch (error) {
    showLogin(error.message === "Please sign in to the admin dashboard." ? "" : error.message);
    return;
  }
  showAdmin(admin.email);
  try {
    await loadAllData();
  } catch (error) {
    showToast(error.message);
  }
}

startAdmin();
