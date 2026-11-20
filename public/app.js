
const movieGrid = document.getElementById("movieGrid");
const searchInput = document.getElementById("searchInput");
const filters = document.querySelectorAll(".filter");

const loginModal = document.getElementById("loginModal");
const loginForm = document.getElementById("loginForm");
const loginMessage = document.getElementById("loginMessage");

const adminPanel = document.getElementById("adminPanel");
const uploadForm = document.getElementById("uploadForm");
const uploadMessage = document.getElementById("uploadMessage");

const playerModal = document.getElementById("playerModal");
const videoPlayer = document.getElementById("videoPlayer");

let movies = [];
let selectedCategory = "All";
let isAdmin = false;

async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...options
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || "Something went wrong.");
  }

  return data;
}

function escapeHTML(value = "") {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

function renderMovies() {
  const search = searchInput.value.trim().toLowerCase();

  const filtered = movies.filter(movie => {
    const matchesSearch =
      movie.title.toLowerCase().includes(search) ||
      (movie.description || "").toLowerCase().includes(search);

    const matchesCategory =
      selectedCategory === "All" ||
      movie.category === selectedCategory;

    return matchesSearch && matchesCategory;
  });

  if (!filtered.length) {
    movieGrid.innerHTML = '<p class="empty">No titles found. Check back soon!</p>';
    return;
  }

  movieGrid.innerHTML = filtered.map(movie => `
    <article class="movie-card">
      <div class="movie-art">CINEWAVE</div>
      <div class="movie-info">
        <h3>${escapeHTML(movie.title)}</h3>
        <p>${escapeHTML(movie.category)}</p>
        <p>${escapeHTML(movie.description || "Discover this title on CINEWAVE.")}</p>
        <div class="movie-actions">
          <button data-play="${movie.id}">WATCH NOW</button>
          ${isAdmin ? `<button data-delete="${movie.id}">DELETE</button>` : ""}
        </div>
      </div>
    </article>
  `).join("");
}

async function loadMovies() {
  try {
    movies = await api("/api/movies");
    renderMovies();
  } catch (error) {
    movieGrid.innerHTML = `<p class="empty">${escapeHTML(error.message)}</p>`;
  }
}

async function checkAdmin() {
  try {
    const result = await api("/api/me");
    isAdmin = result.loggedIn;
    adminPanel.hidden = !isAdmin;
    renderMovies();
  } catch {
    isAdmin = false;
  }
}

document.getElementById("adminOpen").addEventListener("click", () => {
  loginModal.hidden = false;
});

document.getElementById("adminClose").addEventListener("click", () => {
  loginModal.hidden = true;
  loginMessage.textContent = "";
});

loginModal.addEventListener("click", event => {
  if (event.target === loginModal) loginModal.hidden = true;
});

loginForm.addEventListener("submit", async event => {
  event.preventDefault();
  loginMessage.textContent = "Signing in...";

  const formData = new FormData(loginForm);

  try {
    await api("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: formData.get("username"),
        password: formData.get("password")
      })
    });

    loginForm.reset();
    loginModal.hidden = true;
    loginMessage.textContent = "";
    await checkAdmin();
    adminPanel.scrollIntoView({ behavior: "smooth" });
  } catch (error) {
    loginMessage.textContent = error.message;
  }
});

document.getElementById("logoutBtn").addEventListener("click", async () => {
  try {
    await api("/api/logout", { method: "POST" });
    isAdmin = false;
    adminPanel.hidden = true;
    renderMovies();
  } catch (error) {
    alert(error.message);
  }
});

uploadForm.addEventListener("submit", async event => {
  event.preventDefault();
  uploadMessage.textContent = "Uploading... Please wait.";

  try {
    await api("/api/movies", {
      method: "POST",
      body: new FormData(uploadForm)
    });

    uploadForm.reset();
    uploadMessage.textContent = "Upload successful!";
    await loadMovies();
  } catch (error) {
    uploadMessage.textContent = error.message;
  }
});

movieGrid.addEventListener("click", async event => {
  const playButton = event.target.closest("[data-play]");
  const deleteButton = event.target.closest("[data-delete]");

  if (playButton) {
    const movie = movies.find(item => item.id === Number(playButton.dataset.play));
    if (!movie) return;

    document.getElementById("playerTitle").textContent = movie.title;
    document.getElementById("playerDescription").textContent = movie.description || "";
    videoPlayer.src = `/videos/${encodeURIComponent(movie.filename)}`;
    playerModal.hidden = false;
    videoPlayer.play().catch(() => {});
  }

  if (deleteButton && isAdmin) {
    const id = deleteButton.dataset.delete;

    if (!confirm("Are you sure you want to delete this title?")) return;

    try {
      await api(`/api/movies/${id}`, { method: "DELETE" });
      await loadMovies();
    } catch (error) {
      alert(error.message);
    }
  }
});

function closePlayer() {
  videoPlayer.pause();
  videoPlayer.removeAttribute("src");
  videoPlayer.load();
  playerModal.hidden = true;
}

document.getElementById("playerClose").addEventListener("click", closePlayer);

playerModal.addEventListener("click", event => {
  if (event.target === playerModal) closePlayer();
});

searchInput.addEventListener("input", renderMovies);

filters.forEach(button => {
  button.addEventListener("click", () => {
    filters.forEach(item => item.classList.remove("active"));
    button.classList.add("active");
    selectedCategory = button.dataset.category;
    renderMovies();
  });
});

async function startWebsite() {
  await loadMovies();
  await checkAdmin();
}

startWebsite();
