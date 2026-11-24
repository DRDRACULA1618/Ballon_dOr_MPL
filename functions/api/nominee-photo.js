export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const nomineeId = url.searchParams.get("id") || "";
  if (!/^C\d{2}-N\d{2}$/.test(nomineeId)) return new Response("Not found", { status: 404 });
  try {
    const row = await env.DB.prepare("SELECT mime_type, data_base64, updated_at FROM nominee_photos WHERE nominee_id = ?").bind(nomineeId).first();
    if (!row) return new Response("Not found", { status: 404 });
    const binary = atob(row.data_base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Response(bytes, {
      headers: {
        "Content-Type": row.mime_type,
        "Cache-Control": "public, max-age=300",
        "ETag": '"' + row.updated_at + '"',
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("Image unavailable", { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
