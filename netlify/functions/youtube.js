// 유튜브 RSS 피드를 서버(넷틀리파이 함수)에서 직접 가져와 JSON으로 반환합니다.
// 공개 CORS 프록시(codetabs/corsproxy 등)는 자주 죽어서 영상 칸이 빈 채로 멈추는데,
// 이 함수가 서버에서 직접 받아오므로 그 의존을 없앱니다.
// 호출 경로: /.netlify/functions/youtube
const CHANNEL_ID = "UCCxbiZWKg0XgU8oAMEiSwUQ";

function decodeEntities(s) {
  return (s || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(parseInt(n, 10)); });
}

exports.handler = async function () {
  const feed = "https://www.youtube.com/feeds/videos.xml?channel_id=" + CHANNEL_ID;
  try {
    const res = await fetch(feed, { headers: { "User-Agent": "Mozilla/5.0 (compatible; JinjungBot/1.0)" } });
    if (!res.ok) throw new Error("feed status " + res.status);
    const xml = await res.text();
    const entries = xml.split("<entry>").slice(1);
    const videos = entries
      .map(function (e) {
        const id = (e.match(/<yt:videoId>([^<]+)<\/yt:videoId>/) || [])[1] || "";
        const title = decodeEntities((e.match(/<title>([^<]+)<\/title>/) || [])[1] || "");
        const date = ((e.match(/<published>([^<]+)<\/published>/) || [])[1] || "").slice(0, 10);
        return id ? { id: id, title: title, date: date } : null;
      })
      .filter(Boolean)
      .slice(0, 15);
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        // 15분 캐시 (방문자마다 유튜브를 새로 안 때리도록)
        "Cache-Control": "public, max-age=900",
        "Access-Control-Allow-Origin": "*"
      },
      body: JSON.stringify({ updated: new Date().toISOString(), videos: videos })
    };
  } catch (e) {
    return {
      statusCode: 502,
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ videos: [], error: String(e && e.message || e) })
    };
  }
};
