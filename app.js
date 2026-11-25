const FREE_SHIPPING_THRESHOLD = 75;
const SHIPPING_FEE = 5;
let products = [];
let banners = [];

const storageKeys = {
  cart: "goodkind-cart",
  favorites: "goodkind-favorites",
  orders: "goodkind-orders",
};

const state = {
  cart: readStorage(storageKeys.cart, []),
  favorites: readStorage(storageKeys.favorites, []),
  orders: readStorage(storageKeys.orders, []),
  category: "all",
  search: "",
  sort: "featured",
  slide: 0,
  toastTimer: null,
  whatsappNumber: "",
};

const pageSections = [...document.querySelectorAll("[data-page]")];
const navLinks = [...document.querySelectorAll(".nav-link")];
const drawer = document.querySelector("#cart-drawer");
const backdrop = document.querySelector(".drawer-backdrop");

function readStorage(key, fallback) {
  const saved = localStorage.getItem(key);
  if (!saved) return fallback;
  try {
    const parsed = JSON.parse(saved);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch (error) {
    console.error(`Could not read saved storefront data for "${key}".`, error);
    return fallback;
  }
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

async function apiRequest(path, options = {}) {
  let response;
  try {
    response = await fetch(path, {
      ...options,
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
    });
  } catch (error) {
    console.error(`Store API request failed for ${path}.`, error);
    throw new Error("The shop could not connect to its server. Please try again in a moment.");
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof result.detail === "string" ? result.detail : "The shop could not complete that request.";
    throw new Error(message);
  }
  return result;
}

function saveStorage(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function formatPrice(price) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(price);
}

function findProduct(productId) {
  return products.find((product) => product.id === productId);
}

function renderBanners() {
  const container = document.querySelector("#hero-slides");
  const dots = document.querySelector("#carousel-dots");
  const controls = document.querySelector("#hero-controls");
  document.querySelector(".hero-wrap").hidden = banners.length === 0;
  container.innerHTML = banners.map((banner, index) => `
    <article class="hero-slide${index === 0 ? " is-active" : ""}" data-slide="${index}" aria-hidden="${index !== 0}">
      <img src="${escapeHtml(banner.image_url)}" alt="${escapeHtml(banner.image_alt)}" ${index === 0 ? 'fetchpriority="high"' : 'loading="lazy"'} />
      <div class="hero-shade"></div>
      <div class="hero-copy">
        <span class="eyebrow">${escapeHtml(banner.eyebrow)}</span>
        ${index === 0
          ? `<h1>${escapeHtml(banner.headline)}</h1>`
          : `<h2>${escapeHtml(banner.headline)}</h2>`}
        <p>${escapeHtml(banner.description)}</p>
        <button class="button button-dark" type="button" data-action="category" data-category="${escapeHtml(banner.category)}">${escapeHtml(banner.button_label)} <span aria-hidden="true">→</span></button>
      </div>
      <span class="hero-index">${String(index + 1).padStart(2, "0")} <span>/</span> ${String(banners.length).padStart(2, "0")}</span>
    </article>
  `).join("");
  dots.innerHTML = banners.map((banner, index) => `
    <button class="carousel-dot${index === 0 ? " is-active" : ""}" type="button" data-action="go-slide" data-slide="${index}" aria-label="Show banner ${index + 1}" aria-pressed="${index === 0}"></button>
  `).join("");
  controls.hidden = banners.length < 2;
  state.slide = 0;
}

function productCard(product) {
  const favorite = state.favorites.includes(product.id);
  const badge = product.label ? `<span class="product-badge">${escapeHtml(product.label)}</span>` : "";
  return `
    <article class="product-card">
      <div class="product-image-wrap">
        <img src="${escapeHtml(product.image_url)}" alt="${escapeHtml(product.image_alt)}" loading="lazy" />
        ${badge}
        <button class="favorite-button${favorite ? " is-favorite" : ""}" type="button" data-action="favorite" data-id="${escapeHtml(product.id)}" aria-label="${favorite ? "Remove from" : "Add to"} favorites" aria-pressed="${favorite}">&hearts;</button>
      </div>
      <div class="product-info">
        <div class="product-topline">
          <h3 class="product-name">${escapeHtml(product.name)}</h3>
          <span class="product-price">${formatPrice(Number(product.price))}</span>
        </div>
        <div class="product-meta">
          <span>${escapeHtml(product.category[0].toUpperCase())}${escapeHtml(product.category.slice(1))}</span>
          <span class="product-rating" aria-label="${escapeHtml(product.rating)} out of 5 stars">★ ${escapeHtml(product.rating)} <span>(${escapeHtml(product.review_count)})</span></span>
        </div>
        <button class="add-button" type="button" data-action="add" data-id="${escapeHtml(product.id)}">Add to bag <span aria-hidden="true">+</span></button>
      </div>
    </article>
  `;
}

function renderProducts() {
  document.querySelector("#trending-products").innerHTML = products
    .filter((product) => product.trending)
    .map(productCard)
    .join("");

  const filtered = products.filter((product) => {
    const categoryMatches = state.category === "all" || product.category === state.category;
    const query = state.search.trim().toLowerCase();
    const searchMatches = !query || `${product.name} ${product.category} ${product.label}`.toLowerCase().includes(query);
    return categoryMatches && searchMatches;
  });

  const sorted = [...filtered];
  if (state.sort === "price-low") sorted.sort((a, b) => a.price - b.price);
  if (state.sort === "price-high") sorted.sort((a, b) => b.price - a.price);
  if (state.sort === "rating") sorted.sort((a, b) => b.rating - a.rating);

  document.querySelector("#shop-products").innerHTML = sorted.length
    ? sorted.map(productCard).join("")
    : '<p class="empty-products">No finds match that search. Try another word or category.</p>';
  document.querySelector("#results-count").textContent = `${sorted.length} ${sorted.length === 1 ? "find" : "finds"} to love`;
  updateFilterButtons();
}

function updateFilterButtons() {
  document.querySelectorAll('[data-action="filter"]').forEach((button) => {
    const selected = button.dataset.category === state.category;
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
}

function renderCart() {
  const itemCount = state.cart.reduce((total, item) => total + item.quantity, 0);
  const subtotal = state.cart.reduce((total, item) => {
    const product = findProduct(item.id);
    return total + (product ? product.price * item.quantity : 0);
  }, 0);
  const remainingForFreeShipping = Math.max(0, FREE_SHIPPING_THRESHOLD - subtotal);

  const cartCount = document.querySelector(".cart-count");
  cartCount.textContent = String(itemCount);
  cartCount.setAttribute("aria-label", `${itemCount} ${itemCount === 1 ? "item" : "items"} in bag`);
  document.querySelector("#drawer-count").textContent = `(${itemCount})`;
  document.querySelector("#cart-subtotal").textContent = formatPrice(subtotal);
  document.querySelector("#shipping-note").textContent = subtotal === 0
    ? "Add a little something lovely to your bag."
    : remainingForFreeShipping === 0
      ? "Lovely! Your order qualifies for free shipping."
      : `Add ${formatPrice(remainingForFreeShipping)} more for free shipping.`;
  document.querySelector(".checkout-button").disabled = itemCount === 0;
  document.querySelector(".checkout-button").classList.toggle("is-disabled", itemCount === 0);

  const container = document.querySelector("#cart-items");
  if (!state.cart.length) {
    container.innerHTML = '<div class="cart-empty"><strong>Your bag is taking a little breather.</strong><span>Find something lovely to bring home.</span></div>';
    return;
  }

  container.innerHTML = state.cart.map((item) => {
    const product = findProduct(item.id);
    if (!product) {
      return `
        <article class="cart-line">
          <div class="cart-item-unavailable">?</div>
          <div><h3>Product unavailable</h3><p>Remove this item to continue.</p></div>
          <div class="cart-line-total"><button class="remove-item" type="button" data-action="remove" data-id="${escapeHtml(item.id)}">Remove</button></div>
        </article>
      `;
    }
    return `
      <article class="cart-line">
        <img src="${escapeHtml(product.image_url)}" alt="${escapeHtml(product.image_alt)}" />
        <div>
          <h3>${escapeHtml(product.name)}</h3>
          <p>${formatPrice(Number(product.price))}</p>
          <div class="quantity-control" aria-label="Quantity for ${product.name}">
            <button type="button" data-action="quantity" data-id="${escapeHtml(product.id)}" data-change="-1" aria-label="Remove one ${escapeHtml(product.name)}">−</button>
            <span>${item.quantity}</span>
            <button type="button" data-action="quantity" data-id="${escapeHtml(product.id)}" data-change="1" aria-label="Add one ${escapeHtml(product.name)}">+</button>
          </div>
        </div>
        <div class="cart-line-total">
          ${formatPrice(Number(product.price) * item.quantity)}
          <button class="remove-item" type="button" data-action="remove" data-id="${escapeHtml(product.id)}">Remove</button>
        </div>
      </article>
    `;
  }).join("");
}

function renderOrders() {
  const container = document.querySelector("#orders-list");
  if (!state.orders.length) {
    container.innerHTML = `
      <div class="orders-empty">
        <h2>No orders just yet</h2>
        <p>Your WhatsApp checkouts will show up here on this device.</p>
        <button class="button button-outline" type="button" data-action="go-shop">Find something lovely <span aria-hidden="true">→</span></button>
      </div>
    `;
    return;
  }

  container.innerHTML = [...state.orders].reverse().map((order) => {
    const itemSummary = order.items.map((item) => `${item.quantity} × ${item.name}`).join(" · ");
    const date = new Date(order.createdAt).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
    return `
      <article class="order-card">
        <div>
          <h2>Order ${order.id}</h2>
          <p>${date} · ${itemSummary}</p>
          <span class="order-status">WhatsApp checkout started</span>
        </div>
        <span class="order-total">${formatPrice(order.subtotal)}</span>
      </article>
    `;
  }).join("");
}

function setPage(pageName, updateUrl = true) {
  const targetPage = pageName === "trending" ? "home" : pageName;
  if (updateUrl && window.location.hash !== `#${pageName}`) {
    window.history.pushState({ page: pageName }, "", `#${pageName}`);
  }
  pageSections.forEach((section) => {
    const active = section.dataset.page === targetPage;
    section.hidden = !active;
    section.classList.toggle("is-visible", active);
  });
  navLinks.forEach((link) => {
    const active = link.dataset.view === pageName || (pageName === "trending" && link.dataset.view === "trending");
    link.classList.toggle("is-active", active);
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  document.querySelector(".main-nav").classList.remove("is-open");
  document.querySelector(".menu-toggle").setAttribute("aria-expanded", "false");
  if (pageName === "orders") renderOrders();
  if (pageName === "shop") renderProducts();
  if (pageName === "trending") {
    window.setTimeout(() => document.querySelector("#trending-section").scrollIntoView({ behavior: "smooth" }), 0);
  } else {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
}

function setCategory(category, page = "shop") {
  state.category = category;
  state.search = "";
  document.querySelector("#header-search").value = "";
  renderProducts();
  setPage(page);
}

function showToast(message) {
  const toast = document.querySelector("#toast");
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.clearTimeout(state.toastTimer);
  state.toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 2400);
}

function openCart() {
  drawer.classList.add("is-open");
  drawer.setAttribute("aria-hidden", "false");
  drawer.removeAttribute("inert");
  backdrop.hidden = false;
  document.body.classList.add("no-scroll");
  window.requestAnimationFrame(() => backdrop.classList.add("is-visible"));
  drawer.querySelector(".close-drawer").focus();
}

function closeCart() {
  drawer.classList.remove("is-open");
  drawer.setAttribute("aria-hidden", "true");
  drawer.setAttribute("inert", "");
  backdrop.classList.remove("is-visible");
  document.body.classList.remove("no-scroll");
  window.setTimeout(() => {
    if (!drawer.classList.contains("is-open")) backdrop.hidden = true;
  }, 230);
  document.querySelector('[data-action="open-cart"]').focus();
}

function addToCart(productId) {
  const product = findProduct(productId);
  if (!product) return;
  const existing = state.cart.find((item) => item.id === productId);
  if (existing) existing.quantity += 1;
  else state.cart.push({ id: productId, quantity: 1 });
  saveStorage(storageKeys.cart, state.cart);
  renderCart();
  showToast(`${product.name} added to your bag.`);
}

function changeQuantity(productId, change) {
  const item = state.cart.find((cartItem) => cartItem.id === productId);
  if (!item) return;
  item.quantity += change;
  if (item.quantity <= 0) state.cart = state.cart.filter((cartItem) => cartItem.id !== productId);
  saveStorage(storageKeys.cart, state.cart);
  renderCart();
}

async function checkout() {
  if (!state.cart.length) {
    showToast("Your bag is empty. Find something lovely first.");
    return;
  }

  const whatsappWindow = window.open("about:blank", "_blank");
  document.querySelector(".checkout-button").disabled = true;
  try {
    const savedOrder = await apiRequest("/api/orders", {
      method: "POST",
      body: JSON.stringify({
        items: state.cart.map((item) => ({ product_id: item.id, quantity: item.quantity })),
      }),
    });
    const orderNumber = savedOrder.order_number;
    const orderItems = savedOrder.items || [];
    const message = [
      "Hello! I'd like to place an order with Goodkind.",
      `Order: ${orderNumber}`,
      "",
      ...orderItems.map((item) => `${item.quantity} x ${item.product_name} - ${formatPrice(Number(item.line_total))}`),
      "",
      `Subtotal: ${formatPrice(Number(savedOrder.subtotal))}`,
      `Shipping: ${Number(savedOrder.shipping) === 0 ? "Free" : formatPrice(Number(savedOrder.shipping))}`,
      `Estimated total: ${formatPrice(Number(savedOrder.total))}`,
      "",
      "Please let me know the next steps. Thank you!",
    ].join("\n");
    const recipient = state.whatsappNumber;
    const whatsappUrl = recipient
      ? `https://wa.me/${recipient}?text=${encodeURIComponent(message)}`
      : `https://wa.me/?text=${encodeURIComponent(message)}`;
    if (whatsappWindow) {
      whatsappWindow.location.href = whatsappUrl;
    } else {
      window.location.assign(whatsappUrl);
    }

    state.orders.push({
      id: orderNumber,
      items: orderItems.map((item) => ({
        quantity: item.quantity,
        name: item.product_name,
      })),
      subtotal: Number(savedOrder.subtotal),
      createdAt: savedOrder.created_at,
    });
    saveStorage(storageKeys.orders, state.orders);
    state.cart = [];
    saveStorage(storageKeys.cart, state.cart);
    renderCart();
    closeCart();
    showToast("Your order is saved. Complete it in WhatsApp.");
  } catch (error) {
    if (whatsappWindow) whatsappWindow.close();
    showToast(error.message);
  } finally {
    document.querySelector(".checkout-button").disabled = state.cart.length === 0;
  }
}

function showSlide(index) {
  const slides = [...document.querySelectorAll(".hero-slide")];
  if (!slides.length) return;
  state.slide = (index + slides.length) % slides.length;
  slides.forEach((slide, slideIndex) => {
    const active = slideIndex === state.slide;
    slide.classList.toggle("is-active", active);
    slide.setAttribute("aria-hidden", String(!active));
  });
  document.querySelectorAll(".carousel-dot").forEach((dot, dotIndex) => {
    const active = dotIndex === state.slide;
    dot.classList.toggle("is-active", active);
    dot.setAttribute("aria-pressed", String(active));
  });
}

function toggleFavorite(productId) {
  state.favorites = state.favorites.includes(productId)
    ? state.favorites.filter((id) => id !== productId)
    : [...state.favorites, productId];
  saveStorage(storageKeys.favorites, state.favorites);
  renderProducts();
}

async function loadStore() {
  const notice = document.querySelector("#store-status");
  try {
    const [productData, bannerData, config] = await Promise.all([
      apiRequest("/api/products"),
      apiRequest("/api/banners"),
      apiRequest("/api/config"),
    ]);
    if (!Array.isArray(productData) || !Array.isArray(bannerData)) {
      throw new Error("The shop could not load its product catalogue.");
    }
    products = productData;
    banners = bannerData;
    state.whatsappNumber = config.whatsapp_number || "";
    renderBanners();
    renderProducts();
    if (!products.length) {
      notice.textContent = "Your product catalogue is empty. Add your first product in the store admin.";
      notice.hidden = false;
    } else if (!banners.length) {
      notice.textContent = "No active home-page banners yet. Add one in the store admin.";
      notice.hidden = false;
    } else {
      notice.hidden = true;
    }
  } catch (error) {
    products = [];
    banners = [];
    renderBanners();
    renderProducts();
    notice.textContent = `The storefront couldn't load its catalogue: ${error.message}`;
    notice.hidden = false;
  }
  renderCart();
  renderOrders();
}

document.addEventListener("click", (event) => {
  const trigger = event.target.closest("[data-action], [data-view]");
  if (!trigger) return;

  const action = trigger.dataset.action;
  const page = trigger.dataset.view;
  if (page) {
    event.preventDefault();
    setPage(page);
    if (page === "shop" && state.category !== "all") setCategory("all");
    return;
  }

  if (!action) return;
  event.preventDefault();

  if (action === "go-shop") {
    state.category = "all";
    state.search = "";
    document.querySelector("#header-search").value = "";
    setPage("shop");
    renderProducts();
  }
  if (action === "category") setCategory(trigger.dataset.category);
  if (action === "filter") {
    state.category = trigger.dataset.category;
    renderProducts();
  }
  if (action === "add") addToCart(trigger.dataset.id);
  if (action === "favorite") toggleFavorite(trigger.dataset.id);
  if (action === "open-cart") openCart();
  if (action === "close-cart") closeCart();
  if (action === "checkout") checkout();
  if (action === "remove") {
    state.cart = state.cart.filter((item) => item.id !== trigger.dataset.id);
    saveStorage(storageKeys.cart, state.cart);
    renderCart();
  }
  if (action === "quantity") changeQuantity(trigger.dataset.id, Number(trigger.dataset.change));
  if (action === "previous-slide") showSlide(state.slide - 1);
  if (action === "next-slide") showSlide(state.slide + 1);
  if (action === "go-slide") showSlide(Number(trigger.dataset.slide));
  if (action === "open-whatsapp") {
    const recipient = state.whatsappNumber;
    const message = encodeURIComponent("Hello Goodkind! I'd love a little help finding something lovely.");
    window.open(recipient ? `https://wa.me/${recipient}?text=${message}` : `https://wa.me/?text=${message}`, "_blank", "noopener,noreferrer");
  }
});

document.querySelector("#header-search").addEventListener("input", (event) => {
  state.search = event.target.value;
  state.category = "all";
  renderProducts();
  setPage("shop");
});

document.querySelector("#sort-products").addEventListener("change", (event) => {
  state.sort = event.target.value;
  renderProducts();
});

document.querySelector(".menu-toggle").addEventListener("click", (event) => {
  const menu = document.querySelector(".main-nav");
  const isOpen = menu.classList.toggle("is-open");
  event.currentTarget.setAttribute("aria-expanded", String(isOpen));
  event.currentTarget.setAttribute("aria-label", isOpen ? "Close menu" : "Open menu");
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && drawer.classList.contains("is-open")) closeCart();
  if (event.key === "Escape") document.querySelector(".main-nav").classList.remove("is-open");
});

window.addEventListener("popstate", () => {
  const requestedPage = window.location.hash.slice(1);
  setPage(["home", "shop", "trending", "orders"].includes(requestedPage) ? requestedPage : "home", false);
});

let carouselTimer = window.setInterval(() => {
  if (!document.hidden) showSlide(state.slide + 1);
}, 6000);

document.querySelector(".hero-carousel").addEventListener("mouseenter", () => window.clearInterval(carouselTimer));
document.querySelector(".hero-carousel").addEventListener("mouseleave", () => {
  window.clearInterval(carouselTimer);
  carouselTimer = window.setInterval(() => {
    if (!document.hidden) showSlide(state.slide + 1);
  }, 6000);
});

document.querySelector("#current-year").textContent = String(new Date().getFullYear());
loadStore();
const initialPage = window.location.hash.slice(1);
if (["home", "shop", "trending", "orders"].includes(initialPage)) setPage(initialPage, false);
