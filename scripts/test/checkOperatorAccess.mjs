import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";

const supabaseUrl = process.env.SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;

if (!supabaseUrl || !secretKey) {
  throw new Error("Operator access configuration is missing");
}

const supabase = createClient(supabaseUrl, secretKey, {
  auth: { autoRefreshToken: false, persistSession: false },
  realtime: { transport: WebSocket },
});

const { error } = await supabase
  .from("exam_packs")
  .select("id", { count: "exact", head: true });

if (error) {
  throw new Error("Operator read-only access check failed");
}

console.log("Operator read-only access check passed.");
