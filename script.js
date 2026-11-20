
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
  catalogConnected: false
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


/* =========================================
   CUSTOMER SIGN IN
   ========================================= */

const signInButton = getElement("signInButton");

if (signInButton) {

  signInButton.addEventListener("click", () => {

    setMessage(elements.accountMessage, "");

    if (elements.accountTitle) {
      elements.accountTitle.textContent =
        "Welcome to FOGGY";
    }

    if (elements.accountDescription) {
      elements.accountDescription.textContent =
        "Sign in to access your purchased music and personal library.";
    }

    showModal(elements.accountModal);

  });

}


/* =========================================
   CUSTOMER ACCOUNT SUBMISSION
   ========================================= */

const accountSubmit = getElement("accountSubmit");

if (accountSubmit) {

  accountSubmit.addEventListener("click", () => {

    if (
      !elements.accountForm ||
      !elements.accountForm.reportValidity()
    ) {
      return;
    }

    setMessage(
      elements.accountMessage,

      "Secure customer authentication is not connected yet. No account has been created or signed in.",

      true
    );

  });

}


if (elements.accountForm) {

  elements.accountForm.addEventListener(
    "submit",
    event => event.preventDefault()
  );

}


const accountClose = getElement("accountClose");

if (accountClose) {

  accountClose.addEventListener("click", () => {

    closeModal(elements.accountModal);

  });

}


/* =========================================
   ARTIST REGISTRATION
   ========================================= */

const artistStartButton =
  getElement("artistStartButton");


if (artistStartButton) {

  artistStartButton.addEventListener("click", () => {

    setMessage(elements.artistMessage, "");

    showModal(elements.artistModal);

  });

}


/* =========================================
   ARTIST REGISTRATION SUBMISSION
   ========================================= */

const artistSubmit =
  getElement("artistInterestSubmit");


if (artistSubmit) {

  artistSubmit.addEventListener("click", () => {

    if (
      !elements.artistForm ||
      !elements.artistForm.reportValidity()
    ) {
      return;
    }

    setMessage(
      elements.artistMessage,

      "Artist registration is not connected to the secure FOGGY backend yet. Your details have not been submitted.",

      true
    );

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
   INITIALISE FOGGY
   ========================================= */

renderMusic();

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
