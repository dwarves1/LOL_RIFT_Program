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
  damage: number;
  gold: number;
  goldPerMinute: number;
  confidence: number;
};

export type ExtractedScoreboard = {
  durationSeconds: number;
  players: ExtractedScoreboardPlayer[];
  rawText: string;
};

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

function cleanLines(value: string) {
  return value.split(/\r?\n/).map((line) => line.replace(/[<>|_[\]{}]/g, "").trim()).filter(Boolean);
}

function parseInteger(value: string | undefined) {
  return Number.parseInt((value ?? "0").replace(/[^0-9]/g, ""), 10) || 0;
}

function parseNumericRow(text: string) {
  const kda = text.match(/(\d+)\s*[|/]\s*(\d+)\s*[|/]\s*(\d+)/);
  const largeValues = [...text.matchAll(/\b\d{1,3}(?:,\d{3})+\b/g)].map((match) => parseInteger(match[0]));
  const perMinuteLine = cleanLines(text).find((line) => /\/|min|분/i.test(line) && !/\d+\s*\/\s*\d+\s*\//.test(line));
  const perMinute = perMinuteLine?.match(/(\d{2,4})/);
  return {
    kills: parseInteger(kda?.[1]),
    deaths: parseInteger(kda?.[2]),
    assists: parseInteger(kda?.[3]),
    damage: largeValues[0] ?? 0,
    gold: largeValues[1] ?? 0,
    goldPerMinute: parseInteger(perMinute?.[1]),
  };
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
    await nameWorker.setParameters({ preserve_interword_spaces: "1", tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
    await numberWorker.setParameters({
      tessedit_char_whitelist: "0123456789/,.: KDAmin",
      preserve_interword_spaces: "1",
      tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
    });

    const durationResult = await numberWorker.recognize(image, {
      rectangle: scaledRectangle(image.naturalWidth, image.naturalHeight, 232, 20, 92, 30),
    });
    const durationMatch = durationResult.data.text.match(/(\d{1,2})\s*[:.]\s*(\d{2})/);
    const durationSeconds = durationMatch ? parseInteger(durationMatch[1]) * 60 + parseInteger(durationMatch[2]) : 0;
    const players: ExtractedScoreboardPlayer[] = [];
    const raw: string[] = [durationResult.data.text];

    for (let index = 0; index < ROW_CENTERS.length; index += 1) {
      const center = ROW_CENTERS[index];
      onProgress?.(10 + index * 8, `${index + 1}/10 선수 행 분석 중`);
      const [nameResult, numericResult, levelResult] = await Promise.all([
        nameWorker.recognize(image, {
          rectangle: scaledRectangle(image.naturalWidth, image.naturalHeight, 184, center - 20, 175, 40),
        }),
        numberWorker.recognize(image, {
          rectangle: scaledRectangle(image.naturalWidth, image.naturalHeight, 700, center - 18, 286, 42),
        }),
        numberWorker.recognize(image, {
          rectangle: scaledRectangle(image.naturalWidth, image.naturalHeight, 70, center - 17, 30, 34),
        }),
      ]);
      const lines = cleanLines(nameResult.data.text);
      const numbers = parseNumericRow(numericResult.data.text);
      raw.push(nameResult.data.text, numericResult.data.text, levelResult.data.text);
      players.push({
        side: index < 5 ? 1 : 2,
        rowOrder: index + 1,
        accountName: lines[0] ?? "",
        championName: lines[1] ?? "",
        championLevel: parseInteger(levelResult.data.text),
        lane: LANES[index % 5],
        ...numbers,
        goldPerMinute: numbers.gold && durationSeconds ? Math.round(numbers.gold / (durationSeconds / 60)) : numbers.goldPerMinute,
        confidence: Math.round((nameResult.data.confidence + numericResult.data.confidence + levelResult.data.confidence) / 3),
      });
    }
    onProgress?.(100, "자동 추출 완료");
    return { durationSeconds, players, rawText: raw.join("\n") };
  } finally {
    await Promise.all([nameWorker.terminate(), numberWorker.terminate()]);
  }
}
