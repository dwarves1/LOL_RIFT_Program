import type { Worker } from "tesseract.js";

export type OcrPlayerField =
  | "accountName"
  | "championName"
  | "championLevel"
  | "kills"
  | "deaths"
  | "assists"
  | "gold";

export type OcrFieldConfidence = Partial<Record<OcrPlayerField, number>>;

export type ExtractedScoreboardPlayer = {
  side: 1 | 2;
  rowOrder: number;
  accountName: string;
  championName: string;
  championLevel: number;
  lane: "TOP" | "JGL" | "MID" | "ADC" | "SUP";
  kills: number;
  deaths: number;
  assists: number;
  gold: number;
  confidence: number;
  fieldConfidence: OcrFieldConfidence;
};

export type ExtractedScoreboard = {
  durationSeconds: number;
  topOutcome: "win" | "loss" | "unknown";
  topOutcomeConfidence: number;
  players: ExtractedScoreboardPlayer[];
  rawText: string;
};

export type KnownLabelMatch = { value: string; score: number };

const REFERENCE_WIDTH = 1048;
const REFERENCE_HEIGHT = 622;
const ROW_CENTERS = [159, 201, 243, 285, 326, 386, 428, 470, 512, 555];
const LANES = ["TOP", "JGL", "MID", "ADC", "SUP"] as const;

function scaledRectangle(width: number, height: number, left: number, top: number, rectWidth: number, rectHeight: number) {
  const scaleX = width / REFERENCE_WIDTH;
  const scaleY = height / REFERENCE_HEIGHT;
  return {
    left: Math.round(left * scaleX),
    top: Math.round(top * scaleY),
    width: Math.round(rectWidth * scaleX),
    height: Math.round(rectHeight * scaleY),
  };
}

function otsuThreshold(pixels: Uint8ClampedArray) {
  const histogram = new Array<number>(256).fill(0);
  let pixelCount = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    const luminance = Math.round(pixels[index] * 0.299 + pixels[index + 1] * 0.587 + pixels[index + 2] * 0.114);
    histogram[luminance] += 1;
    pixelCount += 1;
  }
  let total = 0;
  for (let index = 0; index < histogram.length; index += 1) total += index * histogram[index];
  let backgroundWeight = 0;
  let backgroundTotal = 0;
  let bestVariance = -1;
  let threshold = 110;
  for (let index = 0; index < histogram.length; index += 1) {
    backgroundWeight += histogram[index];
    if (!backgroundWeight) continue;
    const foregroundWeight = pixelCount - backgroundWeight;
    if (!foregroundWeight) break;
    backgroundTotal += index * histogram[index];
    const backgroundMean = backgroundTotal / backgroundWeight;
    const foregroundMean = (total - backgroundTotal) / foregroundWeight;
    const variance = backgroundWeight * foregroundWeight * (backgroundMean - foregroundMean) ** 2;
    if (variance > bestVariance) {
      bestVariance = variance;
      threshold = index;
    }
  }
  return Math.max(72, Math.min(176, threshold));
}

function cropForOcr(
  image: HTMLImageElement,
  left: number,
  top: number,
  width: number,
  height: number,
  variant: "binary" | "contrast" = "binary",
) {
  const rectangle = scaledRectangle(image.naturalWidth, image.naturalHeight, left, top, width, height);
  const scale = 4;
  const padding = 10;
  const canvas = document.createElement("canvas");
  canvas.width = rectangle.width * scale + padding * 2;
  canvas.height = rectangle.height * scale + padding * 2;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("이미지를 분석할 수 없습니다.");
  context.fillStyle = "#000";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(
    image,
    rectangle.left,
    rectangle.top,
    rectangle.width,
    rectangle.height,
    padding,
    padding,
    rectangle.width * scale,
    rectangle.height * scale,
  );

  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  const threshold = otsuThreshold(pixels.data);
  for (let index = 0; index < pixels.data.length; index += 4) {
    const luminance = pixels.data[index] * 0.299 + pixels.data[index + 1] * 0.587 + pixels.data[index + 2] * 0.114;
    const value = variant === "binary" ? (luminance >= threshold ? 0 : 255) : Math.max(0, Math.min(255, Math.round(255 - (luminance - 24) * 1.35)));
    pixels.data[index] = value;
    pixels.data[index + 1] = value;
    pixels.data[index + 2] = value;
    pixels.data[index + 3] = 255;
  }
  context.putImageData(pixels, 0, 0);
  return canvas;
}

async function recognizeBest(
  worker: Worker,
  image: HTMLImageElement,
  rectangle: [number, number, number, number],
) {
  const first = await worker.recognize(cropForOcr(image, ...rectangle, "binary"));
  if (first.data.confidence >= 62 && first.data.text.trim()) return first;
  const second = await worker.recognize(cropForOcr(image, ...rectangle, "contrast"));
  return second.data.confidence > first.data.confidence ? second : first;
}

function cleanText(value: string) {
  return value.replace(/[<>|_[\]{}]/g, "").replace(/\s+/g, " ").trim();
}

function parseInteger(value: string | undefined) {
  return Number.parseInt((value ?? "0").replace(/[^0-9]/g, ""), 10) || 0;
}

export function parseTopOutcome(value: string) {
  const normalized = value.normalize("NFKC").replace(/[^\p{L}]/gu, "").toLocaleLowerCase("ko-KR");
  if (/승리|win/.test(normalized)) return "win" as const;
  if (/패배|defeat|loss|lose/.test(normalized)) return "loss" as const;
  return "unknown" as const;
}

export function parseKda(value: string) {
  const normalized = value.replace(/[|Il]/g, "/");
  const matched = normalized.match(/(\d{1,2})\s*[/:.]\s*(\d{1,2})\s*[/:.]\s*(\d{1,2})/);
  const fallback = normalized.match(/\d{1,2}/g) ?? [];
  return {
    kills: parseInteger(matched?.[1] ?? fallback[0]),
    deaths: parseInteger(matched?.[2] ?? fallback[1]),
    assists: parseInteger(matched?.[3] ?? fallback[2]),
  };
}

function normalizeKnownLabel(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("ko-KR").replace(/[^\p{L}\p{N}]/gu, "");
}

function editDistance(left: string, right: string) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    let diagonal = previous[0];
    previous[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const above = previous[rightIndex];
      previous[rightIndex] = Math.min(
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + 1,
        diagonal + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return previous[right.length];
}

export function findBestKnownLabel(input: string, candidates: string[], minimumScore = 0.6): KnownLabelMatch | null {
  const normalizedInput = normalizeKnownLabel(input);
  if (!normalizedInput || !candidates.length) return null;
  let best: KnownLabelMatch | null = null;
  for (const candidate of candidates) {
    const normalizedCandidate = normalizeKnownLabel(candidate);
    if (!normalizedCandidate) continue;
    const distance = editDistance(normalizedInput, normalizedCandidate);
    const score = 1 - distance / Math.max(normalizedInput.length, normalizedCandidate.length);
    if (!best || score > best.score) best = { value: candidate, score };
  }
  return best && best.score >= minimumScore ? best : null;
}

export async function extractFixedLolScoreboard(
  image: HTMLImageElement,
  onProgress?: (progress: number, detail: string) => void,
): Promise<ExtractedScoreboard> {
  const ratio = image.naturalWidth / image.naturalHeight;
  const referenceRatio = REFERENCE_WIDTH / REFERENCE_HEIGHT;
  if (Math.abs(ratio - referenceRatio) > 0.18) {
    throw new Error("예시 점수판과 화면 비율이 다릅니다. 원본 전체 화면 이미지를 사용해 주세요.");
  }

  const { createWorker, PSM } = await import("tesseract.js");
  const progressByWorker = { names: 0, numbers: 0 };
  const emitProgress = (worker: "names" | "numbers", value: number, detail: string) => {
    progressByWorker[worker] = value;
    onProgress?.(Math.round((progressByWorker.names + progressByWorker.numbers) * 50), detail);
  };
  const [nameWorker, numberWorker] = await Promise.all([
    createWorker(["kor", "eng"], undefined, {
      logger: (message) => message.status === "recognizing text" && emitProgress("names", message.progress, "계정명과 챔피언을 읽는 중"),
    }),
    createWorker("eng", undefined, {
      logger: (message) => message.status === "recognizing text" && emitProgress("numbers", message.progress, "경기 수치를 읽는 중"),
    }),
  ]);

  try {
    await nameWorker.setParameters({ preserve_interword_spaces: "1", tessedit_pageseg_mode: PSM.SINGLE_LINE });
    await numberWorker.setParameters({
      tessedit_char_whitelist: "0123456789/,.: ",
      preserve_interword_spaces: "1",
      tessedit_pageseg_mode: PSM.SINGLE_LINE,
    });

    const outcomeResult = await recognizeBest(nameWorker, image, [52, 0, 118, 52]);
    const topOutcome = parseTopOutcome(outcomeResult.data.text);
    const durationResult = await recognizeBest(numberWorker, image, [232, 20, 92, 30]);
    const durationMatch = durationResult.data.text.match(/(\d{1,2})\s*[:.]\s*(\d{2})/);
    const durationSeconds = durationMatch ? parseInteger(durationMatch[1]) * 60 + parseInteger(durationMatch[2]) : 0;
    const players: ExtractedScoreboardPlayer[] = [];
    const raw: string[] = [outcomeResult.data.text, durationResult.data.text];

    for (let index = 0; index < ROW_CENTERS.length; index += 1) {
      const center = ROW_CENTERS[index];
      onProgress?.(10 + index * 8, `${index + 1}/10 선수 행 분석 중`);
      const [accountResult, championResult, levelResult, kdaResult, goldResult] = await Promise.all([
        recognizeBest(nameWorker, image, [184, center - 22, 175, 22]),
        recognizeBest(nameWorker, image, [184, center, 150, 21]),
        recognizeBest(numberWorker, image, [68, center - 18, 36, 36]),
        recognizeBest(numberWorker, image, [708, center - 22, 96, 24]),
        recognizeBest(numberWorker, image, [908, center - 22, 82, 24]),
      ]);
      const kda = parseKda(kdaResult.data.text);
      const gold = parseInteger(goldResult.data.text);
      const fieldConfidence: OcrFieldConfidence = {
        accountName: Math.round(accountResult.data.confidence),
        championName: Math.round(championResult.data.confidence),
        championLevel: Math.round(levelResult.data.confidence),
        kills: Math.round(kdaResult.data.confidence),
        deaths: Math.round(kdaResult.data.confidence),
        assists: Math.round(kdaResult.data.confidence),
        gold: Math.round(goldResult.data.confidence),
      };
      raw.push(accountResult.data.text, championResult.data.text, levelResult.data.text, kdaResult.data.text, goldResult.data.text);
      players.push({
        side: index < 5 ? 1 : 2,
        rowOrder: index + 1,
        accountName: cleanText(accountResult.data.text),
        championName: cleanText(championResult.data.text),
        championLevel: parseInteger(levelResult.data.text),
        lane: LANES[index % 5],
        ...kda,
        gold,
        fieldConfidence,
        confidence: Math.round(Object.values(fieldConfidence).reduce((sum, value) => sum + (value ?? 0), 0) / Object.keys(fieldConfidence).length),
      });
    }
    onProgress?.(100, "자동 추출 완료");
    return {
      durationSeconds,
      topOutcome,
      topOutcomeConfidence: Math.round(outcomeResult.data.confidence),
      players,
      rawText: raw.join("\n"),
    };
  } finally {
    await Promise.all([nameWorker.terminate(), numberWorker.terminate()]);
  }
}
