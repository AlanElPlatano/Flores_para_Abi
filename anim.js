const LYRICS_URL = "sound/letras.xml";
const WORD_CONTINUES_MARKER = "-";
const LINE_BREAK_MARKER = "+";
const LINE_LEAD_IN_SECONDS = 0.35;

const audio = document.querySelector("audio");
const lyricsContainer = document.querySelector("#lyrics");
const closingMessage = document.querySelector(".titulo");

let lines = [];
let closingMessageTime = Infinity;
let activeLine = null;
let sungSyllableCount = 0;

function splitAfter(items, endsGroup) {
  const groups = [];
  let current = [];
  for (const item of items) {
    current.push(item);
    if (endsGroup(item)) {
      groups.push(current);
      current = [];
    }
  }
  if (current.length > 0) {
    groups.push(current);
  }
  return groups;
}

function readSyllable(vocal) {
  let text = vocal.getAttribute("lyric");
  const endsLine = text.endsWith(LINE_BREAK_MARKER);
  if (endsLine) {
    text = text.slice(0, -1);
  }
  const continuesWord = text.endsWith(WORD_CONTINUES_MARKER);
  if (continuesWord) {
    text = text.slice(0, -1);
  }
  const time = Number(vocal.getAttribute("time"));
  return {
    text,
    time,
    end: time + Number(vocal.getAttribute("length")),
    continuesWord,
    endsLine,
  };
}

async function fetchSyllables() {
  const response = await fetch(LYRICS_URL);
  const xml = new DOMParser().parseFromString(await response.text(), "text/xml");
  return [...xml.querySelectorAll("vocal")].map(readSyllable);
}

function buildSyllableElement(text) {
  const element = document.createElement("span");
  element.className = "lyrics__syllable";
  element.textContent = text;
  return element;
}

function buildWordElement(syllables) {
  const element = document.createElement("span");
  element.className = "lyrics__word";
  for (const syllable of syllables) {
    syllable.element = buildSyllableElement(syllable.text);
    element.append(syllable.element);
  }
  return element;
}

function buildLineElement(syllables) {
  const element = document.createElement("p");
  element.className = "lyrics__line";
  element.hidden = true;
  const words = splitAfter(syllables, (syllable) => !syllable.continuesWord);
  words.forEach((word, index) => {
    if (index > 0) {
      element.append(" ");
    }
    element.append(buildWordElement(word));
  });
  return element;
}

function toLine(syllables) {
  return {
    syllables,
    start: syllables[0].time,
    end: syllables[syllables.length - 1].end,
    element: buildLineElement(syllables),
  };
}

/* Cada línea aparece un poco antes de su primera sílaba, pero nunca encima de la
   anterior: hay pares de versos separados por solo 30 ms. */
function scheduleLines(scheduled) {
  scheduled.forEach((line, index) => {
    const previousEnd = index > 0 ? scheduled[index - 1].end : 0;
    line.showAt = Math.max(previousEnd, line.start - LINE_LEAD_IN_SECONDS);
  });
  scheduled.forEach((line, index) => {
    const next = scheduled[index + 1];
    line.hideAt = next ? next.showAt : line.end;
  });
}

function lineAt(time) {
  return lines.find((line) => time >= line.showAt && time < line.hideAt) ?? null;
}

function clearHighlight(line) {
  for (const syllable of line.syllables) {
    syllable.element.classList.remove("is-sung");
  }
}

function setActiveLine(line) {
  if (line === activeLine) {
    return;
  }
  if (activeLine) {
    activeLine.element.hidden = true;
    clearHighlight(activeLine);
  }
  activeLine = line;
  sungSyllableCount = 0;
  if (line) {
    line.element.hidden = false;
  }
}

function highlightSungSyllables(line, time) {
  let count = 0;
  while (count < line.syllables.length && time >= line.syllables[count].time) {
    count += 1;
  }
  if (count === sungSyllableCount) {
    return;
  }
  line.syllables.forEach((syllable, index) => {
    syllable.element.classList.toggle("is-sung", index < count);
  });
  sungSyllableCount = count;
}

/* El mensaje entra cuando acaban las voces, no cuando acaba el audio: lo que
   resta es instrumental y suena de fondo mientras se lee. */
function renderFrame() {
  if (audio.ended) {
    return;
  }
  const time = audio.currentTime;
  const line = lineAt(time);
  setActiveLine(line);
  if (line) {
    highlightSungSyllables(line, time);
  }
  const vocalsFinished = time >= closingMessageTime;
  document.body.classList.toggle("song-ended", vocalsFinished);
  closingMessage.classList.toggle("is-visible", vocalsFinished);
  requestAnimationFrame(renderFrame);
}

/* El evento que habilita el audio no es el mismo en todos los navegadores: iOS Safari
   solo cuenta el gesto en `touchend`/`click`, no en `pointerdown`. Se escuchan varios y
   gana el primero. */
const TAP_EVENTS = ["pointerup", "touchend", "click"];

/* Si el audio no despega, mejor un jardín en silencio que una pantalla negra. */
const SILENT_START_MS = 6000;

/* Toques que se le piden al usuario antes de rendirse y seguir sin música. */
const MAX_TAP_ATTEMPTS = 3;

function startAnimations() {
  document.body.classList.remove("animations-paused");
}

/* El plazo corre mientras se espera que el audio despegue, pero no mientras se espera
   el toque del usuario: ahí la página no está rota, solo está esperando. */
let silentStartTimer = 0;

function armSilentStart() {
  window.clearTimeout(silentStartTimer);
  silentStartTimer = window.setTimeout(startAnimations, SILENT_START_MS);
}

function disarmSilentStart() {
  window.clearTimeout(silentStartTimer);
}

/* `play()` se llama DENTRO del manejador del toque, de forma síncrona: si se llama
   después de un `await`, Safari ya no lo considera parte del gesto del usuario. */
function playOnNextTap() {
  document.body.classList.add("awaiting-tap");
  return new Promise((resolve, reject) => {
    const onTap = () => {
      for (const type of TAP_EVENTS) {
        document.removeEventListener(type, onTap);
      }
      document.body.classList.remove("awaiting-tap");
      armSilentStart();
      audio.play().then(resolve, reject);
    };
    for (const type of TAP_EVENTS) {
      document.addEventListener(type, onTap);
    }
  });
}

/* Los navegadores bloquean el autoplay sin interacción previa en el sitio. Si tras el
   toque sigue bloqueado se vuelve a pedir el gesto, en vez de rendirse: antes, un
   segundo rechazo de `play()` dejaba la página muerta — las flores congeladas (que es
   como no verlas) y sin música ni letras. */
async function startPlayback() {
  /* El primer intento también necesita plazo: si `play()` se queda colgado (pasa con
     red lenta) no se rechaza nunca, y sin esto no se mostraría ni el aviso. */
  armSilentStart();
  try {
    await audio.play();
    return;
  } catch {
    disarmSilentStart();
  }
  /* Tras el toque el plazo ya no se desarma: si el navegador se sigue negando, el
     jardín florece igual, aunque sea en silencio. */
  for (let attempt = 0; attempt < MAX_TAP_ATTEMPTS; attempt += 1) {
    try {
      await playOnNextTap();
      return;
    } catch {
      /* el navegador lo rechazó igual: se vuelve a pedir el toque */
    }
  }
  startAnimations();
}

async function start() {
  const syllables = await fetchSyllables();
  lines = splitAfter(syllables, (syllable) => syllable.endsLine).map(toLine);
  scheduleLines(lines);
  for (const line of lines) {
    lyricsContainer.append(line.element);
  }
  closingMessageTime = lines[lines.length - 1].end;

  /* Las flores arrancan cuando de verdad empieza a sonar la música, no cuando `play()`
     devuelve: en un teléfono con red lenta esa promesa puede tardar o no resolverse. */
  audio.addEventListener("playing", startAnimations, { once: true });
  /* Y si el mp3 no carga (404, red caída, formato), que el jardín florezca igual. */
  audio.addEventListener("error", startAnimations, { once: true });

  requestAnimationFrame(renderFrame);
  await startPlayback();
}

start();
