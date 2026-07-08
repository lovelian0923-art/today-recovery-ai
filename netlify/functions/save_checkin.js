const { createClient } = require("@supabase/supabase-js");

exports.handler = async (event, context) => {
  // CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST, OPTIONS"
      },
      body: ""
    };
  }

  try {
    if (event.httpMethod !== "POST") {
      return {
        statusCode: 405,
        body: JSON.stringify({ error: "Method Not Allowed" })
      };
    }

    const { user_uuid, todayCheckin } = JSON.parse(event.body || "{}");

    if (!user_uuid || !todayCheckin) {
      return {
        statusCode: 400,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ error: "Missing user_uuid or todayCheckin" })
      };
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      console.warn("Supabase environment credentials missing. Returning fallback success.");
      return {
        statusCode: 200,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ message: "Mock save successful (keys missing in environment)" })
      };
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    let authUserId = null;
    const authHeader = event.headers.authorization || event.headers.Authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      const { data: { user }, error: authError } = await supabase.auth.getUser(token);
      if (user && !authError) {
        authUserId = user.id;
      }
    }

    // checkins 테이블에 새로운 레코드 삽입
    let insertData = {
        user_uuid: user_uuid,
        user_id: authUserId,
        checkin_date: todayCheckin.date || new Date().toISOString(),
        goals: todayCheckin.goals || [],
        period_symptoms: todayCheckin.periodSymptoms || [],
        sleep: todayCheckin.sleep || "normal",
        sleep_quality: todayCheckin.sleepQuality || "normal",
        wake: todayCheckin.wake || "normal",
        on_period: todayCheckin.onPeriod || "no",
        condition: todayCheckin.condition || "normal",
        fatigue: todayCheckin.fatigue || "normal",
        bloating: todayCheckin.bloating || "none",
        digestion: todayCheckin.digestion || "good",
        appetite: todayCheckin.appetite || "normal",
        overeating: todayCheckin.overeating || "none",
        alcohol: todayCheckin.alcohol || "none",
        late_snack: todayCheckin.lateSnack || "none",
        y_sleep: todayCheckin.ySleep || "none",
        workout_available: todayCheckin.workoutAvailable || "none",
        raw_record: todayCheckin,
        result_type: todayCheckin.resultType || "미지정",
        coach: todayCheckin.coach || ""
    };

    let { data, error } = await supabase.from("checkins").insert(insertData).select();

    // 만약 raw_record, result_type, coach 컬럼이 Supabase에 없어서 발생하는 오류(42703)라면
    // 해당 컬럼들을 제외하고 다시 시도합니다.
    if (error && error.code === '42703') {
      console.warn("Missing columns in Supabase checkins table. Retrying with base schema.");
      delete insertData.raw_record;
      delete insertData.result_type;
      delete insertData.coach;
      const fallback = await supabase.from("checkins").insert(insertData).select();
      data = fallback.data;
      error = fallback.error;
    }

    if (error) {
      throw error;
    }

    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ success: true, data })
    };

  } catch (err) {
    console.error("Supabase checkins save failed:", err);
    return {
      statusCode: 500,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ error: "Internal Database Error", details: err.toString() })
    };
  }
};
