const LYRICS_URL = "sound/letras.xml";
const WORD_CONTINUES_MARKER = "-";
const LINE_BREAK_MARKER = "+";
const LINE_LEAD_IN_SECONDS = 0.35;

const audio = document.querySelector("audio");
const lyricsContainer = document.querySelector("#lyrics");
const closingMessage = document.querySelector(".titulo");

let lines = [];
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
    line.hideAt = next ? next.showAt : Infinity;
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
  requestAnimationFrame(renderFrame);
}

/* La última línea se queda hasta aquí: es este relevo el que la retira. */
function showClosingMessage() {
  setActiveLine(null);
  document.body.classList.add("song-ended");
  closingMessage.classList.add("is-visible");
}

function waitForTap() {
  document.body.classList.add("awaiting-tap");
  return new Promise((resolve) => {
    document.addEventListener(
      "pointerdown",
      () => {
        document.body.classList.remove("awaiting-tap");
        resolve();
      },
      { once: true }
    );
  });
}

/* Los navegadores bloquean el autoplay sin interacción previa en el sitio. */
async function startPlayback() {
  try {
    await audio.play();
  } catch {
    await waitForTap();
    await audio.play();
  }
}

async function start() {
  const syllables = await fetchSyllables();
  lines = splitAfter(syllables, (syllable) => syllable.endsLine).map(toLine);
  scheduleLines(lines);
  for (const line of lines) {
    lyricsContainer.append(line.element);
  }
  audio.addEventListener("ended", showClosingMessage, { once: true });

  await startPlayback();
  document.body.classList.remove("animations-paused");
  requestAnimationFrame(renderFrame);
}

start();
