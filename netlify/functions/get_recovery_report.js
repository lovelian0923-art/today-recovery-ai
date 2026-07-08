const { GoogleGenerativeAI, SchemaType } = require("@google/generative-ai");

// 준비된 Mock Response (Fallback용)
const mockResponse = {
  aiReport: {
    coachMessage: "오늘의 호르몬 주기 흐름과 약간의 피로 지수를 감안할 때, 무리하게 속도를 내기보다 호흡을 길게 가져가는 것이 몸의 아름다운 리듬을 지켜내는 비결입니다. 스스로를 따뜻하게 챙겨주세요.",
    priorityUpdates: [
      {
        "index": 0,
        "title": "따뜻한 음용 습관",
        "desc": "염분 배출과 혈액 순환을 돕기 위해 차가운 물 대신 미온수를 머그컵으로 자주 섭취해 주세요."
      },
      {
        "index": 1,
        "title": "가벼운 위장 리프레시",
        "desc": "위장 소화력을 복구할 수 있도록 부드러운 순살 단백질과 유기농 채소 비중을 높여보세요."
      }
    ],
    foodTips: [
      "식이섬유 흡수를 극대화하기 위해 데친 토마토나 브로콜리를 곁들여보세요.",
      "포만감을 오래 유지하고 대사를 돕기 위해 올리브유 드레싱이나 견과류를 추가해 보세요."
    ],
    mealRecommendations: [
      {
        "title": "따뜻한 단백질 회복식",
        "desc": "생리 리듬과 피로감을 고려해 따뜻한 국물, 달걀, 두부처럼 부담이 적은 단백질을 추천합니다.",
        "tag": "생리 리듬"
      },
      {
        "title": "붓기 완화 균형식",
        "desc": "나트륨이 높은 메뉴보다 채소, 해조류, 물을 함께 챙기는 구성이 좋습니다.",
        "tag": "붓기 완화"
      }
    ],
    moveTip: "가벼운 스트레칭과 복식 호흡으로 골반 순환을 일깨우는 15분 슬로우 요가를 권장합니다.",
    avoidTips: [
      "차가운 탄산음료",
      "서 있거나 굽히는 고정된 자세"
    ]
  }
};

// Rate limiting cache (best effort in serverless environment)
const ipCache = new Map();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 5;

function checkRateLimit(ip) {
  if (ip === 'unknown') return true; // Skip if IP can't be determined
  const now = Date.now();
  const record = ipCache.get(ip) || { count: 0, firstRequest: now };
  
  if (now - record.firstRequest > RATE_LIMIT_WINDOW) {
    record.count = 1;
    record.firstRequest = now;
  } else {
    record.count += 1;
  }
  
  ipCache.set(ip, record);
  return record.count <= MAX_REQUESTS_PER_WINDOW;
}

exports.handler = async (event, context) => {
  try {
    // 0. IP Rate Limiting
    const clientIp = event.headers['x-forwarded-for'] || event.headers['client-ip'] || 'unknown';
    if (!checkRateLimit(clientIp)) {
      return {
        statusCode: 429,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ error: "Too Many Requests. Please try again later." })
      };
    }

    // 1. HTTP METHOD 검증
    if (event.httpMethod !== "POST") {
      return {
        statusCode: 405,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ error: "Method Not Allowed" })
      };
    }

    // 2. 입력 데이터 파싱 및 검증
    if (!event.body || event.body.length > 20000) { // Payload size limit
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ error: "Payload too large or empty" })
      };
    }

    const bodyData = JSON.parse(event.body || "{}");
    if (!bodyData.todayCheckin || !bodyData.currentPreset) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ error: "Missing required fields: todayCheckin, currentPreset" })
      };
    }

    const { profile, todayCheckin, historySummary, currentPreset, recentMealTitles, calculatedCycleDay, calculatedPeriodPhase, daysUntilNextPeriod } = bodyData;

    const apiKey = process.env.GEMINI_API_KEY;
    const modelName = process.env.GEMINI_MODEL || "gemini-3.5-flash";

    // 1단계 Fallback: API Key가 없으면 즉시 Mock 반환 (200 OK)
    if (!apiKey) {
      console.warn("[Gemini] Fallback mock: missing API key");
      return {
        statusCode: 200,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        },
        body: JSON.stringify(mockResponse)
      };
    }

    // 2단계: Gemini API 호출 시도
    try {
      console.log("[Gemini] API key found");
      console.log(`[Gemini] Calling model: ${modelName}`);
      const genAI = new GoogleGenerativeAI(apiKey);

      const responseSchema = {
        type: SchemaType.OBJECT,
        properties: {
          status_type: { type: SchemaType.STRING, description: "오늘 상태 유형 이름 (예: 음주·과식 복합 회복일)" },
          priorities: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING }, description: "우선순위 1, 2, 3" },
          mealRecommendations: {
            type: SchemaType.ARRAY,
            description: "오늘 상태와 연결된 추천 회복 식단 1~2개",
            items: {
              type: SchemaType.OBJECT,
              properties: {
                title: { type: SchemaType.STRING, description: "현실적인 메뉴명" },
                desc: { type: SchemaType.STRING, description: "오늘 상태와 연결된 추천 이유 + 먹는 방법" },
                tag: { type: SchemaType.STRING, description: "태그 (예: 수면 회복 / 식욕 안정 / 붓기 완화 / 생리 리듬 / 소화 부담 완화 / 운동 전후 중 택 1)" }
              },
              required: ["title", "desc", "tag"]
            }
          },
          exercise: {
            type: SchemaType.OBJECT,
            properties: {
              intensity: { type: SchemaType.STRING, description: "저강도/중강도/휴식 중 택 1" },
              example: { type: SchemaType.STRING, description: "예시 운동 1개" }
            }
          },
          daily_routine: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING }, description: "수분/카페인/휴식/취침 관련 조정 항목들" },
          dont_do_today: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING }, description: "오늘 하지 말아야 할 행동 2~3개" },
          coach_message: { type: SchemaType.STRING, description: "다정하지만 단호한 코치 톤의 한 줄 회복 메시지" },
          cycle_info: { type: SchemaType.STRING, description: "생리주기 관련 코멘트 (해당 시, 없으면 빈 문자열)" }
        },
        required: ["status_type", "priorities", "mealRecommendations", "exercise", "daily_routine", "dont_do_today", "coach_message", "cycle_info"]
      };

      const model = genAI.getGenerativeModel({
        model: modelName,
        generationConfig: { 
          responseMimeType: "application/json",
          responseSchema: responseSchema
        }
      });

      // 프롬프트 구성
      const prompt = `
당신은 다정하지만 단호한 INTJ 회복 코치입니다. 훈계하지 않되 애매하게 말하지 않습니다.
사용자의 오늘 상태(체크인 데이터)와 과거 기록, 생리 주기 정보를 분석하여 맞춤형 회복 리포트를 작성해주세요.

[안전 규칙 - 필수 엄수]
1. 굶기, 절식, 보상운동, 극단적 칼로리 제한은 절대 권하지 않습니다.
2. 임신, 질환, 섭식장애, 심한 통증 관련 입력이 의심되거나 포함된 경우, 루틴 대신 전문가 상담을 안내하세요.
3. 의료 진단적인 표현은 금지합니다.

[사용자 데이터]
- 오늘 체크인: ${JSON.stringify(todayCheckin)}
- 최근 식단 이력: ${JSON.stringify(recentMealTitles || [])}
- 과거 요약: ${JSON.stringify(historySummary || {})}
- 생리 주기: ${calculatedCycleDay}일차 (${calculatedPeriodPhase}) / 다음 예정일까지 ${daysUntilNextPeriod}일

위 데이터를 종합하여 지정된 JSON 구조로 응답해주세요.
`;

      console.log('[Gemini] Report requested');
      
      let parsedData = null;
      let retries = 1;
      
      while (retries >= 0) {
        try {
          console.log(`[Gemini] Requesting generation... (Retries left: ${retries})`);
          const result = await model.generateContent(prompt);
          const responseText = result.response.text();
          const cleanJsonText = responseText.replace(/```json/g, "").replace(/```/g, "").trim();
          parsedData = JSON.parse(cleanJsonText);
          
          if (parsedData && parsedData.status_type) {
            break; // Valid
          }
          throw new Error("Missing required field: status_type");
        } catch (e) {
          if (retries === 0) {
            console.error("[Gemini] Parsing failed permanently:", e.message);
            return {
              statusCode: 200,
              headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
              body: JSON.stringify({ error: "retry" })
            };
          }
          retries--;
          console.warn("[Gemini] Retrying due to parse error:", e.message);
        }
      }

      console.log("[Gemini] Success");
      return {
        statusCode: 200,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        },
        body: JSON.stringify({ aiReport: parsedData })
      };

    } catch (apiErr) {
      console.error("[Gemini] Fallback mock: API error", apiErr);
      return {
        statusCode: 200,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        },
        body: JSON.stringify(mockResponse)
      };
    }

  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Internal Server Error", details: err.toString() })
    };
  }
};
