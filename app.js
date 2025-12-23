const CSV_FILE = "top100_union_2025120610.csv";
const { createApp, nextTick } = Vue;

// Mets ici EXACTEMENT tes fichiers dans /fond
const FOND_IMAGES = [
  "Ata Kak.png",
  "Asil Hadkins.png",
  "Louise Forestier.png",
  "Monsieur Tranquille.png",
];

function makeKey(title, artist) {
  return (title || "").trim().toLowerCase() + "___" + (artist || "").trim().toLowerCase();
}

function normalizeArtworkUrl(raw) {
  if (!raw) return "";
  let url = raw.trim();
  if (!url) return "";
  if (url.startsWith("http://") || url.startsWith("https://")) return url;

  url = url.replace(/\\/g, "/");
  const parts = url.split("/");
  const fileName = parts[parts.length - 1];
  return "image/" + fileName;
}

function normalizeYoutubeUrl(raw) {
  if (!raw) return "";
  let url = raw.trim();
  if (!url) return "";
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  return "https://" + url.replace(/^\/+/, "");
}

function parseRank(val) {
  const n = parseInt((val || "").trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function fondLabelFromFilename(filename) {
  return (filename || "")
    .replace(/\.[^.]+$/, "")
    .replace(/[_\-]/g, " ")
    .toUpperCase();
}

createApp({
  data() {
    return {
      songsRaw: [],
      loading: true,
      csvFile: CSV_FILE,

      fondImages: FOND_IMAGES,

      currentMode: "minutes",
      modes: [
        {
          id: "lectures",
          label: "Top lectures",
          rankField: "rankLectures",
          help: "Classement basé uniquement sur le nombre total d’écoutes."
        },
        {
          id: "minutes",
          label: "Top minutes",
          rankField: "rankMinutes",
          help: "Classement selon le temps total d’écoute cumulé (durée × lectures)."
        },
        {
          id: "zscore",
          label: "Top z-score",
          rankField: "rankZscore",
          help: "Méthode ou le nombre d'écoute vaut pour 75% et la durée pour 25%"
        },
        {
          id: "jessye",
          label: "Méthode Jessye",
          rankField: "rankJessye",
          help: "Méthode proposé par Jessye ,basée sur le nombre d'écoute et si seulement la chanson dépasse 6 minutes , il y a un bonus d'écoute"
        }
      ],

      // Tooltip
      openHelpId: null,

      // Observer
      _io: null,

      // Fond scroll
      _rafPending: false,
      _lastFondFilename: "",
      _lastFondVisible: null,

      // listeners
      _onDocPointerDown: null,
      _onResize: null,
      _onScrollClose: null,
    };
  },

  computed: {
    currentModeConfig() {
      return this.modes.find((m) => m.id === this.currentMode) || null;
    },

    helpTitle() {
      const m = this.modes.find(x => x.id === this.openHelpId);
      return m ? m.label : "";
    },

    helpText() {
      const m = this.modes.find(x => x.id === this.openHelpId);
      return m ? m.help : "";
    },

    // Top 100 = rangs 1..100 affichés 100 -> 1 (ordre décroissant)
    filteredSongs() {
      if (!this.songsRaw.length) return [];
      const cfg = this.currentModeConfig;
      if (!cfg || !cfg.rankField) return this.songsRaw.slice(0, 100);

      const field = cfg.rankField;

      return this.songsRaw
        .filter((s) => Number.isFinite(s[field]) && s[field] >= 1 && s[field] <= 100)
        .slice()
        .sort((a, b) => b[field] - a[field]);
    },
  },

  watch: {
    currentMode() {
      // ferme le tooltip quand on change d’onglet
      this.closeHelp();

      nextTick(() => {
        this.resetCardsVisibility();
        this.setupObserver(true);
        this.measureTabsHeight();
      });
    },
  },

  mounted() {
    this.loadCsv();

    // Scroll fond
    const onScrollFond = () => {
      if (this._rafPending) return;
      this._rafPending = true;
      requestAnimationFrame(() => {
        this._rafPending = false;
        this.updateFond();
      });
    };
    window.addEventListener("scroll", onScrollFond, { passive: true });

    // Fermer tooltip sur scroll (mobile friendly)
    this._onScrollClose = () => {
      if (this.openHelpId) this.closeHelp();
    };
    window.addEventListener("scroll", this._onScrollClose, { passive: true });

    // Fermer tooltip si clic/tap ailleurs (pointerdown)
    this._onDocPointerDown = () => {
      if (this.openHelpId) this.closeHelp();
    };
    document.addEventListener("pointerdown", this._onDocPointerDown);

    // Resize -> re-mesure tabs
    this._onResize = () => this.measureTabsHeight();
    window.addEventListener("resize", this._onResize);
  },

  beforeUnmount() {
    if (this._io) this._io.disconnect();
    if (this._onDocPointerDown) document.removeEventListener("pointerdown", this._onDocPointerDown);
    if (this._onResize) window.removeEventListener("resize", this._onResize);
    if (this._onScrollClose) window.removeEventListener("scroll", this._onScrollClose);
  },

  methods: {
    setMode(modeId) {
      if (this.currentMode === modeId) return;
      this.currentMode = modeId;
    },

    toggleHelp(modeId) {
      this.openHelpId = (this.openHelpId === modeId) ? null : modeId;
    },

    closeHelp() {
      this.openHelpId = null;
    },

    // Mesure la hauteur réelle des tabs et met à jour --tabs-h
    measureTabsHeight() {
      const wrapper = document.querySelector(".tabs-sticky-wrapper");
      if (!wrapper) return;
      const h = Math.ceil(wrapper.getBoundingClientRect().height || 0);
      if (h > 0) {
        document.documentElement.style.setProperty("--tabs-h", `${h}px`);
      }
    },

    loadCsv() {
      Papa.parse(this.csvFile, {
        download: true,
        header: true,
        skipEmptyLines: true,
        delimiter: ";",
        complete: (results) => {
          const rows = results.data;
          const songs = [];

          rows.forEach((row) => {
            const title = (row["Titre"] || "").trim();
            const artist = (row["Artiste"] || "").trim();
            const album = (row["Album"] || "").trim();
            if (!title || !artist) return;

            const duree = parseFloat(row["Duree_min"] || "0") || 0;
            const minutesTotales = parseFloat(row["Minutes_totales"] || "0") || 0;
            const lectures = parseInt(row["Lectures"] || "0", 10) || 0;
            if (lectures <= 0 || duree <= 0) return;

            const artworkUrl = normalizeArtworkUrl(row["Artwork_URL"] || "");
            const youtubeUrl = normalizeYoutubeUrl(row["Lien_YouTube"] || "");
            const comment = (row["Commentaire"] || "").trim();

            songs.push({
              id: makeKey(title, artist),

              title,
              titleUpper: title.toUpperCase(),

              artist,
              artistUpper: artist.toUpperCase(),

              album,
              albumUpper: album.toUpperCase(),

              duration: duree,
              totalMinutes: minutesTotales,
              plays: lectures,

              artworkUrl,
              youtubeUrl,
              comment,

              rankLectures: parseRank(row["Rang_lectures"]),
              rankMinutes: parseRank(row["Rang_minutes"]),
              rankZscore: parseRank(row["Rang_zscore"]),
              rankJessye: parseRank(row["Rang_jessye"]),
            });
          });

          this.songsRaw = songs;
          this.loading = false;

          nextTick(() => {
            this.resetCardsVisibility();
            this.setupObserver(true);
            this.updateFond();
            this.measureTabsHeight();
          });
        },
        error: (err) => {
          console.error("Erreur CSV:", err);
          this.loading = false;
        },
      });
    },

    resetCardsVisibility() {
      document.querySelectorAll(".song-card.visible").forEach((el) => el.classList.remove("visible"));
    },

    setupObserver(forceRecreate = false) {
      const cards = document.querySelectorAll(".song-card");
      if (!cards.length) return;

      if (forceRecreate && this._io) {
        this._io.disconnect();
        this._io = null;
      }

      if (!this._io) {
        this._io = new IntersectionObserver(
          (entries) => {
            entries.forEach((entry) => {
              if (entry.isIntersecting) {
                entry.target.classList.add("visible");
                this._io.unobserve(entry.target);
              }
            });
          },
          { threshold: 0.15 }
        );
      }

      cards.forEach((c) => this._io.observe(c));
    },

    displayRank(song) {
      const cfg = this.currentModeConfig;
      if (!cfg || !cfg.rankField) return "";
      const val = song[cfg.rankField];
      return val != null ? val : "";
    },

    updateFond() {
      const fondLayer = document.getElementById("fond-layer");
      const signet = document.getElementById("fond-signet");
      const signetText = document.getElementById("fond-signet-text");
      const hero = document.getElementById("hero");

      if (!fondLayer || !signet || !this.fondImages.length) return;

      const scrollY = window.scrollY || window.pageYOffset;
      const heroHeight = hero ? hero.offsetHeight : window.innerHeight;

      // commence l'affichage des fonds quand tu es rendu après le hero
      const threshold = heroHeight * 0.6;

      if (scrollY < threshold) {
        if (this._lastFondVisible !== false) {
          fondLayer.style.opacity = "0";
          fondLayer.style.backgroundImage = "none";
          signet.classList.remove("visible");
          this._lastFondVisible = false;
          this._lastFondFilename = "";
        }
        return;
      }

      const relativeY = scrollY - threshold;
      const step = 2000;
      const rawIndex = Math.floor(relativeY / step);
      const index = ((rawIndex % this.fondImages.length) + this.fondImages.length) % this.fondImages.length;

      const filename = this.fondImages[index];

      if (this._lastFondFilename !== filename || this._lastFondVisible !== true) {
        fondLayer.style.opacity = "1";
        fondLayer.style.backgroundImage = `url("fond/${filename}")`;

        signet.classList.add("visible");
        this._lastFondVisible = true;
        this._lastFondFilename = filename;

        if (signetText) {
          signetText.textContent = fondLabelFromFilename(filename);
        }
      }
    },
  },
}).mount("#app");
