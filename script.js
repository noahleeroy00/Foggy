
/* =========================================
   FOGGY — FRONTEND APPLICATION
   ========================================= */

/*
  API configuration.

  The Cloudflare Worker backend will use:
  /api/music
  /api/auth/customer/login
  /api/auth/artist/register
  /api/checkout/create

  These endpoints are not live yet.
*/

const FOGGY_CONFIG = {
  API_BASE: "/api",
  CURRENCY: "ZAR"
};


/* =========================================
   APPLICATION ELEMENTS
   ========================================= */

const elements = {
  grid: document.getElementById("musicGrid"),
  singlesGrid: document.getElementById("singlesGrid"),
  albumsGrid: document.getElementById("albumsGrid"),

  search: document.getElementById("searchInput"),
  empty: document.getElementById("emptyState"),
  loading: document.getElementById("musicLoading"),

  artistModal: document.getElementById("artistModal"),
  accountModal: document.getElementById("accountModal"),
  infoModal: document.getElementById("infoModal"),

  artistForm: document.getElementById("artistForm"),
  artistMessage: document.getElementById("artistFormMessage"),

  accountForm: document.getElementById("accountForm"),
  accountMessage: document.getElementById("accountMessage"),

  accountTitle: document.getElementById("accountTitle"),
  accountDescription: document.getElementById("accountDescription"),

  infoTitle: document.getElementById("infoTitle"),
  infoText: document.getElementById("infoText"),

  menu: document.querySelector(".desktop-nav"),
  menuToggle: document.getElementById("menuToggle")
};


/* =========================================
   APPLICATION STATE
   ========================================= */

const state = {
  music: [],
  filter: "all",
  search: "",
  loading: false,
  catalogConnected: false,
  currentUser: null
};


/* =========================================
   GENERAL HELPERS
   ========================================= */

function getElement(id) {
  return document.getElementById(id);
}


function showModal(modal) {
  if (!modal) return;

  if (typeof modal.showModal === "function") {
    if (!modal.open) {
      modal.showModal();
    }
  }
}


function closeModal(modal) {
  if (!modal) return;

  if (modal.open) {
    modal.close();
  }
}


function showInfo(title, message) {
  if (elements.infoTitle) {
    elements.infoTitle.textContent = title;
  }

  if (elements.infoText) {
    elements.infoText.textContent = message;
  }

  showModal(elements.infoModal);
}


function setMessage(element, message, isError = false) {
  if (!element) return;

  element.textContent = message;

  element.style.color = isError
    ? "#b42318"
    : "#5b7411";
}


function formatPrice(price) {
  const amount = Number(price);

  if (!Number.isFinite(amount) || amount < 0) {
    return "Price unavailable";
  }

  return new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency: FOGGY_CONFIG.CURRENCY
  }).format(amount);
}


function safeText(value) {
  return typeof value === "string"
    ? value.trim()
    : "";
}


/* =========================================
   API CONNECTION
   ========================================= */

async function apiRequest(endpoint, options = {}) {

  const url =
    FOGGY_CONFIG.API_BASE +
    endpoint;

  const response = await fetch(url, {
    ...options,

    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },

    credentials: "same-origin"
  });

  let data = {};

  try {
    data = await response.json();
  } catch {
    data = {};
  }

  if (!response.ok) {
    throw new Error(
      data.message ||
      "The request could not be completed."
    );
  }

  return data;
}


/* =========================================
   MUSIC CATALOGUE
   ========================================= */

/*
  Only approved and published music should
  be returned by the secure backend.

  No invented demo music is displayed.
*/

async function loadMusic() {

  if (state.loading) return;

  state.loading = true;

  if (elements.loading) {
    elements.loading.hidden = false;
    elements.loading.textContent = "Loading music...";
  }

  if (elements.grid) {
    elements.grid.setAttribute("aria-busy", "true");
  }

  try {

    const response = await apiRequest(
      "/music?status=published"
    );

    const music = Array.isArray(response)
      ? response
      : response.items;

    if (!Array.isArray(music)) {
      throw new Error("Invalid music catalogue response.");
    }

    state.music = music.filter(item => {

      return (
        item &&
        ["single", "album"].includes(item.type) &&
        item.id !== undefined &&
        safeText(item.title) &&
        safeText(item.artist)
      );

    });

    state.catalogConnected = true;

    renderMusic();

  } catch (error) {

    console.error(
      "FOGGY catalogue:",
      error.message
    );

    state.music = [];
    state.catalogConnected = false;

    renderMusic();

    if (elements.empty) {
      elements.empty.textContent =
        "The FOGGY music catalogue is not connected yet. Published music will appear here once the backend is ready.";
    }

  } finally {

    state.loading = false;

    if (elements.loading) {
      elements.loading.hidden = true;
    }

    if (elements.grid) {
      elements.grid.setAttribute("aria-busy", "false");
    }

  }

}


/* =========================================
   MUSIC FILTERING
   ========================================= */

function getFilteredMusic(filter = "all") {

  const query = state.search.toLowerCase();

  return state.music.filter(item => {

    const matchesType =
      filter === "all" ||
      item.type === filter;

    const searchableText = [
      item.title,
      item.artist,
      item.album,
      item.genre,
      item.type
    ]
      .map(value => safeText(value))
      .join(" ")
      .toLowerCase();

    const matchesSearch =
      searchableText.includes(query);

    return matchesType && matchesSearch;

  });

}


/* =========================================
   MUSIC CARD CREATION
   ========================================= */

function createMusicCard(item) {

  const article = document.createElement("article");

  article.className = "music-card";

  const cover = document.createElement("div");

  cover.className = "cover";

  const artwork = safeText(
    item.artworkUrl
  );

  if (artwork) {

    const image = document.createElement("img");

    image.src = artwork;
    image.alt = item.title + " artwork";
    image.loading = "lazy";

    image.style.width = "100%";
    image.style.height = "100%";
    image.style.objectFit = "cover";

    image.addEventListener("error", () => {
      image.remove();
    });

    cover.appendChild(image);

  } else {

    const coverWord = document.createElement("span");

    coverWord.className = "cover-word";
    coverWord.textContent = item.title;

    cover.appendChild(coverWord);

  }


  const tag = document.createElement("span");

  tag.className = "cover-tag";

  tag.textContent =
    item.type === "album"
      ? "ALBUM"
      : "SINGLE";

  cover.appendChild(tag);


  const type = document.createElement("p");

  type.className = "music-type";
  type.textContent = item.type;


  const title = document.createElement("h3");

  title.className = "music-title";
  title.textContent = item.title;


  const artist = document.createElement("p");

  artist.className = "music-artist";
  artist.textContent = item.artist;


  const bottom = document.createElement("div");

  bottom.className = "music-bottom";


  const price = document.createElement("span");

  price.className = "music-price";
  price.textContent = formatPrice(item.price);


  const buyButton = document.createElement("button");

  buyButton.className = "buy-button";
  buyButton.type = "button";

  buyButton.dataset.buy = String(item.id);

  buyButton.textContent =
    item.type === "album"
      ? "Buy album ↗"
      : "Buy single ↗";


  bottom.append(price, buyButton);

  article.append(
    cover,
    type,
    title,
    artist,
    bottom
  );

  return article;

}


/* =========================================
   MUSIC DISPLAY
   ========================================= */

function renderGrid(container, music) {

  if (!container) return;

  container.replaceChildren();

  music.forEach(item => {

    container.appendChild(
      createMusicCard(item)
    );

  });

}


function renderMusic() {

  const allMusic = getFilteredMusic("all");

  const singles = getFilteredMusic("single");

  const albums = getFilteredMusic("album");


  renderGrid(
    elements.grid,
    allMusic
  );


  renderGrid(
    elements.singlesGrid,
    singles
  );


  renderGrid(
    elements.albumsGrid,
    albums
  );


  if (elements.empty) {

    elements.empty.hidden =
      allMusic.length !== 0;

    if (!state.catalogConnected) {

      elements.empty.textContent =
        "The FOGGY music catalogue is not connected yet. Published music will appear here once the backend is ready.";

    } else {

      elements.empty.textContent =
        "No music matches your search yet.";

    }

  }

}


/* =========================================
   MUSIC FILTER BUTTONS
   ========================================= */

document.querySelectorAll(".filter-button")
  .forEach(button => {

    button.addEventListener("click", () => {

      document.querySelectorAll(".filter-button")
        .forEach(item => {

          item.classList.remove("active");

          item.setAttribute(
            "aria-pressed",
            "false"
          );

        });


      button.classList.add("active");

      button.setAttribute(
        "aria-pressed",
        "true"
      );


      state.filter = button.dataset.filter;

      renderMusic();

    });

  });


/* =========================================
   MUSIC SEARCH
   ========================================= */

if (elements.search) {

  elements.search.addEventListener(
    "input",
    event => {

      state.search =
        event.target.value.trim();

      renderMusic();

    }
  );

}


/* =========================================
   PURCHASE ACTIONS
   ========================================= */

document.addEventListener("click", event => {

  const button = event.target.closest("[data-buy]");

  if (!button) return;


  const musicId = button.dataset.buy;

  const item = state.music.find(
    music => String(music.id) === musicId
  );

  if (!item) return;


  showInfo(
    "Purchase " + item.title,

    "Secure checkout is not connected yet. Your payment will only be accepted after FOGGY's payment provider and server-side payment verification have been configured."
  );

});


/* =========================================
   CUSTOMER LIBRARY
   ========================================= */

const libraryButton = getElement("libraryButton");

if (libraryButton) {

  libraryButton.addEventListener("click", () => {

    showInfo(
      "Your music library",

      "Sign in to access your purchased singles and albums. Your library, playback and downloads will be connected to your secure FOGGY account."
    );

  });

}



/* CUSTOMER SIGN IN AND REGISTRATION */

let customerAccountMode = "login";

const accountModeToggle = getElement("accountModeToggle");
const accountSubmit = getElement("accountSubmit");
const accountPassword = getElement("accountPassword");

function updateCustomerAccountMode() {
  const registering = customerAccountMode === "register";

  if (elements.accountTitle) {
    elements.accountTitle.textContent = registering
      ? "Create your FOGGY account"
      : "Welcome to FOGGY";
  }

  if (elements.accountDescription) {
    elements.accountDescription.textContent = registering
      ? "Create an account to purchase music and build your personal library."
      : "Sign in to access your purchased music and personal library.";
  }

  if (accountSubmit) {
    accountSubmit.textContent = registering
      ? "Create account"
      : "Sign in";
  }

  if (accountModeToggle) {
    accountModeToggle.textContent = registering
      ? "Already have an account? Sign in"
      : "Create a customer account instead";
  }

  if (accountPassword) {
    accountPassword.minLength = registering ? 12 : 0;
    accountPassword.autocomplete = registering
      ? "new-password"
      : "current-password";
  }
}


const signInButton = getElement("signInButton");

function updateAccountNavigation() {
  if (!signInButton) return;

  if (state.currentUser) {
    signInButton.textContent = "Sign out";
    signInButton.setAttribute("aria-label", "Sign out of FOGGY");
  } else {
    signInButton.textContent = "Sign in";
    signInButton.setAttribute("aria-label", "Sign in to FOGGY");
  }
}

if (signInButton) {
  signInButton.addEventListener("click", async () => {
    if (!state.currentUser) {
      customerAccountMode = "login";
      updateCustomerAccountMode();
      setMessage(elements.accountMessage, "");
      showModal(elements.accountModal);
      return;
    }

    signInButton.disabled = true;

    try {
      await apiRequest("/auth/logout", {
        method: "POST",
        body: JSON.stringify({})
      });

      state.currentUser = null;
      updateAccountNavigation();

      showInfo("Signed out", "You have successfully signed out of FOGGY.");
    } catch (error) {
      showInfo("Sign out failed", error.message || "Please try again.");
    } finally {
      signInButton.disabled = false;
    }
  });
}

updateAccountNavigation();


if (accountModeToggle) {
  accountModeToggle.addEventListener("click", () => {
    customerAccountMode =
      customerAccountMode === "login" ? "register" : "login";

    setMessage(elements.accountMessage, "");
    updateCustomerAccountMode();
  });
}

if (elements.accountForm) {
  elements.accountForm.addEventListener("submit", async event => {
    event.preventDefault();

    if (!elements.accountForm.reportValidity()) return;

    const formData = new FormData(elements.accountForm);
    const submitButton = getElement("accountSubmit");

    const payload = {
      email: formData.get("email").trim(),
      password: formData.get("password")
    };

    const endpoint = customerAccountMode === "register"
      ? "/auth/customer/register"
      : "/auth/customer/login";

    submitButton.disabled = true;
    submitButton.textContent = customerAccountMode === "register"
      ? "Creating account..."
      : "Signing in...";

    setMessage(elements.accountMessage, "");

    try {
      const result = await apiRequest(endpoint, {
        method: "POST",
        body: JSON.stringify(payload)
      });

      setMessage(
        elements.accountMessage,
        result.message || "Your account is ready.",
        false
      );

      elements.accountForm.reset();

      // Registration and login both create a server session.
      // The browser stores the HttpOnly session cookie.

      if (result.user) {
  state.currentUser = result.user;
  updateAccountNavigation();

  console.log("FOGGY customer session established:", {
    email: result.user.email,
    role: result.user.role
  });
      }

    } catch (error) {
      setMessage(
        elements.accountMessage,
        error.message || "Authentication failed. Please try again.",
        true
      );
    } finally {
      submitButton.disabled = false;
      updateCustomerAccountMode();
    }
  });
}

const accountClose = getElement("accountClose");

if (accountClose) {
  accountClose.addEventListener("click", () => {
    closeModal(elements.accountModal);
  });
}

updateCustomerAccountMode();





/* ARTIST REGISTRATION AND LOGIN */

let artistAccountMode = "register";

const artistStartButton = getElement("artistStartButton");
const artistClose = getElement("artistClose");
const artistModeToggle = getElement("artistModeToggle");

function updateArtistAccountMode() {
  const registering = artistAccountMode === "register";

  const artistNameInput = elements.artistForm?.querySelector('[name="artistName"]');
  const phoneInput = elements.artistForm?.querySelector('[name="phone"]');
  const bioInput = elements.artistForm?.querySelector('[name="bio"]');
  const passwordInput = elements.artistForm?.querySelector('[name="password"]');

  [artistNameInput, phoneInput, bioInput].forEach(input => {
    if (!input) return;

    const label = input.closest("label");

    if (label) {
      label.hidden = !registering;
    }

    input.required = registering && input !== bioInput;
  });

  if (passwordInput) {
    passwordInput.minLength = registering ? 12 : 0;
    passwordInput.autocomplete = registering
      ? "new-password"
      : "current-password";
  }

  const heading = elements.artistForm?.querySelector("h2");
  const intro = elements.artistForm?.querySelector(".modal-intro");
  const submitButton = getElement("artistInterestSubmit");

  if (heading) {
    heading.textContent = registering
      ? "Bring your music here."
      : "Welcome back.";
  }

  if (intro) {
    intro.textContent = registering
      ? "Create your artist account, upload singles and albums, and sell directly to your listeners."
      : "Sign in to access your FOGGY artist account.";
  }

  if (submitButton) {
    submitButton.textContent = registering
      ? "Register as an artist"
      : "Sign in as an artist";
  }

  if (artistModeToggle) {
    artistModeToggle.textContent = registering
      ? "Already have an artist account? Sign in"
      : "Need an artist account? Register";
  }
}

if (artistStartButton) {
  artistStartButton.addEventListener("click", () => {
    artistAccountMode = "register";
    elements.artistForm?.reset();
    setMessage(elements.artistMessage, "");
    updateArtistAccountMode();
    showModal(elements.artistModal);
  });
}

if (artistClose) {
  artistClose.addEventListener("click", () => {
    closeModal(elements.artistModal);
  });
}

if (artistModeToggle) {
  artistModeToggle.addEventListener("click", () => {
    artistAccountMode =
      artistAccountMode === "register" ? "login" : "register";

    elements.artistForm?.reset();
    setMessage(elements.artistMessage, "");
    updateArtistAccountMode();
  });
}

updateArtistAccountMode();

if (elements.artistForm) {
  elements.artistForm.addEventListener("submit", async event => {
    event.preventDefault();

    if (!elements.artistForm.reportValidity()) return;

    const submitButton = getElement("artistInterestSubmit");
    const formData = new FormData(elements.artistForm);
    const registering = artistAccountMode === "register";

    const payload = {
      email: formData.get("email").trim(),
      password: formData.get("password")
    };

    if (registering) {
      payload.artistName = formData.get("artistName").trim();
      payload.phone = formData.get("phone").trim();
      payload.bio = formData.get("bio").trim();
    }

    const endpoint = registering
      ? "/auth/artist/register"
      : "/auth/artist/login";

    submitButton.disabled = true;
    submitButton.textContent = registering
      ? "Creating account..."
      : "Signing in...";

    setMessage(elements.artistMessage, "");

    try {
      const result = await apiRequest(endpoint, {
        method: "POST",
        body: JSON.stringify(payload)
      });

      if (result.user) {
  state.currentUser = result.user;
  updateAccountNavigation();
      }

      setMessage(
        elements.artistMessage,
        result.message || (
          registering
            ? "Artist account created successfully."
            : "You are now signed in."
        ),
        false
      );

      elements.artistForm.reset();

      console.log("FOGGY artist authentication successful:", {
        email: result.user?.email,
        role: result.user?.role
      });

    } catch (error) {
      setMessage(
        elements.artistMessage,
        error.message || "Artist authentication failed. Please try again.",
        true
      );
    } finally {
      submitButton.disabled = false;
      updateArtistAccountMode();
    }
  });
}

/* =========================================
   INFORMATION MODAL
   ========================================= */

const infoClose = getElement("infoClose");

const infoOkay = getElement("infoOkay");


if (infoClose) {

  infoClose.addEventListener("click", () => {

    closeModal(elements.infoModal);

  });

}


if (infoOkay) {

  infoOkay.addEventListener("click", () => {

    closeModal(elements.infoModal);

  });

}


/* =========================================
   MOBILE NAVIGATION
   ========================================= */

if (elements.menu && elements.menuToggle) {

  elements.menu.id = "mainNavigation";

  elements.menuToggle.addEventListener("click", () => {

    const isOpen =
      elements.menu.classList.toggle("open");

    elements.menuToggle.setAttribute(
      "aria-expanded",
      String(isOpen)
    );

  });


  elements.menu.querySelectorAll("a")
    .forEach(link => {

      link.addEventListener("click", () => {

        elements.menu.classList.remove("open");

        elements.menuToggle.setAttribute(
          "aria-expanded",
          "false"
        );

      });

    });

}


/* =========================================
   MODAL BACKDROP CLOSING
   ========================================= */

document.querySelectorAll("dialog.modal")
  .forEach(modal => {

    modal.addEventListener("click", event => {

      if (event.target === modal) {
        closeModal(modal);
      }

    });

  });


/* =========================================
   FOOTER YEAR
   ========================================= */

const yearElement = getElement("year");

if (yearElement) {

  yearElement.textContent =
    new Date().getFullYear();

}


/* =========================================
   SESSION RESTORATION
   ========================================= */

async function loadCurrentUser() {
  try {
    const result = await apiRequest("/auth/me");

    state.currentUser = result.user || null;
    updateAccountNavigation();

    console.log("FOGGY session restored:", {
      email: state.currentUser?.email,
      role: state.currentUser?.role
    });

    return state.currentUser;

  } catch (error) {
    state.currentUser = null;
    updateAccountNavigation();

    if (error.message !== "Not authenticated.") {
      console.error("FOGGY session check failed:", error.message);
    }

    return null;
  }
}


/* =========================================
   INITIALISE FOGGY
   ========================================= */

renderMusic();

loadCurrentUser();

loadMusic();


/* =========================================
   FOGGY COMMISSION RULE
   ========================================= */

/*
  Platform commission = sale amount * 0.14
  Artist share = sale amount * 0.86

  Example:
  R100 sale = R14 FOGGY
  R100 sale = R86 artist

  Before payment-processing fees,
  refunds, taxes or other agreed adjustments.

  Commission calculations must ultimately
  be performed and recorded by the backend.
*/

/* =========================================
   FOGGY — PWA REGISTRATION
   ========================================= */

if ("serviceWorker" in navigator) {

  window.addEventListener("load", () => {

    navigator.serviceWorker.register("/sw.js", {
      scope: "/"
    })

    .then(registration => {

      console.log(
        "FOGGY PWA registered:",
        registration.scope
      );

    })

    .catch(error => {

      console.error(
        "FOGGY PWA registration failed:",
        error
      );

    });

  });

}
