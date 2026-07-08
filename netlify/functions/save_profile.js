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

    const { user_uuid, profile } = JSON.parse(event.body || "{}");

    if (!user_uuid || !profile) {
      return {
        statusCode: 400,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ error: "Missing user_uuid or profile" })
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

    // profiles 테이블에 upsert 실행
    const { data, error } = await supabase
      .from("profiles")
      .upsert({
        user_uuid: user_uuid,
        user_id: authUserId,
        nickname: profile.nickname || "회원님",
        height: profile.height,
        weight: profile.weight,
        period_cycle: profile.periodCycle || 28,
        period_days: profile.periodDays || 5,
        period_start: profile.periodStart || null,
        notification_enabled: profile.notification_enabled || false,
        notification_time: profile.notification_time || "09:00",
        updated_at: new Date().toISOString()
      }, { onConflict: "user_uuid" })
      .select();

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
    console.error("Supabase profiles upsert failed:", err);
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
