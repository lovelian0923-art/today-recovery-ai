exports.handler = async (event, context) => {
  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    },
    body: JSON.stringify({
      supabaseUrl: process.env.SUPABASE_URL || "",
      supabasePublishableKey: process.env.SUPABASE_PUBLISHABLE_KEY || ""
    })
  };
};
