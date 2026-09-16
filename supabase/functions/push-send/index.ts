// ============================================================================
// push-send — рассылка «сегодня выезд»
// ============================================================================
// Зовётся кроном раз в сутки. Так же, как wialon-ingest: функция тупая,
// вся выборка живёт в SQL (push_due), потому что SQL проверяется на живом
// Postgres, а Edge Function — нет.
//
// Деплой:
//   supabase functions deploy push-send --no-verify-jwt
//   supabase secrets set PUSH_SECRET=<случайная строка>
//   supabase secrets set VAPID_KEYS='<JSON из DEPLOY-3, одной строкой>'
//   supabase secrets set VAPID_CONTACT=mailto:ты@почта
//
// Библиотека — Deno-нативная (jsr:@negrel/webpush). npm:web-push тянет
// Node-крипту и на Deno Deploy не заводится.
// ============================================================================
import * as webpush from "jsr:@negrel/webpush@0.3";
import { createClient } from "jsr:@supabase/supabase-js@2";
const SECRET = Deno.env.get("PUSH_SECRET") ?? "";
const VAPID = Deno.env.get("VAPID_KEYS") ?? "";
const CONTACT = Deno.env.get("VAPID_CONTACT") ?? "mailto:admin@example.com";
// Вид уведомления берётся из запроса: ?kind=trip_today|trip_move|trip_late
// Раньше был зашит константой, из-за чего новые виды алертов не отправлялись.
// Пустой или неизвестный — падаем на trip_today, чтобы старое расписание
// продолжало работать без изменений.
const ALLOWED_KINDS = new Set(["trip_today", "trip_move", "trip_late", "trip_start_late", "trip_escalated", "trip_auto_started", "trip_finish_candidate"]);
const sb = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: {
    persistSession: false
  }
});
function secretEq(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for(let i = 0; i < a.length; i++)d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
Deno.serve(async (req)=>{
  const url = new URL(req.url);
  const kindParam = (url.searchParams.get("kind") ?? "").trim();
  const KIND = ALLOWED_KINDS.has(kindParam) ? kindParam : "trip_today";

  if (!SECRET || !secretEq(url.searchParams.get("k") ?? "", SECRET)) {
    return new Response("forbidden", {
      status: 403
    });
  }
  if (!VAPID) return new Response("no vapid keys", {
    status: 500
  });
  const server = await webpush.ApplicationServer.new({
    contactInformation: CONTACT,
    vapidKeys: await webpush.importVapidKeys(JSON.parse(VAPID))
  });
  const { data, error } = await sb.rpc("push_due", {
    p_kind: KIND
  });
  if (error) {
    console.error("push_due", error.message);
    return new Response("db error", {
      status: 500
    });
  }
  const rows = data ?? [];
  let sent = 0, gone = 0, failed = 0;
  for (const r of rows){
    try {
      const subscriber = server.subscribe({
        endpoint: r.endpoint,
        keys: {
          p256dh: r.p256dh,
          auth: r.auth
        }
      });
      await subscriber.pushTextMessage(JSON.stringify({
        title: r.title,
        body: r.body,
        // Один tag на выезд: два устройства одного инженера не дадут
        //два одинаковых уведомления на экране.
        tag: "trip-" + r.trip_id
      }), {});
      await sb.rpc("push_ok", {
        p_sub: r.sub_id
      });
      await sb.rpc("push_mark", {
        p_trip: r.trip_id,
        p_user: r.user_id,
        p_kind: KIND,
        p_ok: true,
        p_note: ""
      });
      sent++;
    } catch (e) {
      // 410 Gone = подписки больше нет (переустановили PWA, снесли
      // разрешение). Такую удаляем сразу, а не долбим вечно.
      const isGone = e instanceof webpush.PushMessageError && e.isGone();
      if (isGone) gone++;
      else failed++;
      console.error("push failed", r.endpoint.slice(-12), isGone ? "gone" : String(e));
      await sb.rpc("push_fail", {
        p_sub: r.sub_id,
        p_gone: isGone
      });
    // push_mark НЕ ставим: не дошло — пусть попробует завтра.
    }
  }
  const out = {
    due: rows.length,
    sent,
    gone,
    failed
  };
  console.log(JSON.stringify(out));
  return new Response(JSON.stringify(out), {
    status: 200,
    headers: {
      "Content-Type": "application/json"
    }
  });
});
