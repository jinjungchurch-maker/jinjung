// build-board.js
// 노션 게시판 데이터를 읽어 board-data.json 파일을 만듭니다.
// 토큰은 코드에 적지 않고, 환경변수(NOTION_TOKEN)에서 읽습니다.
//
// 실행: node build-board.js
// 필요 환경변수:
//   NOTION_TOKEN       : 노션 API 통합 토큰 (ntn_... 또는 secret_...)
//   NOTION_DATABASE_ID : 게시판 데이터베이스 ID (기본값 아래에 넣어둠)

const fs = require("fs");

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const DATABASE_ID =
  process.env.NOTION_DATABASE_ID || "378caa6ab69380bea0c1ffcfbdced89d";

// 노션 속성 이름 (노션 데이터베이스의 칸 이름과 정확히 일치해야 함)
// 띄어쓰기 등 변형이 있어도 찾을 수 있도록, 후보 이름을 배열로 둡니다.
const PROP = {
  title: ["제목"],
  category: ["카테고리"],
  date: ["날짜"],
  files: ["파일과 미디어", "파일과미디어", "첨부"], // 첨부 (띄어쓰기 변형 대응)
  checkbox: ["체크박스", "공개"],                  // 공개 여부
};

// 속성 객체에서 후보 이름 중 실제 존재하는 것을 찾아 반환
function findProp(props, candidates) {
  for (const name of candidates) {
    if (props[name]) return props[name];
  }
  return null;
}

// ---- 유튜브 최신 영상 → youtube-data.json (노션 토큰 불필요) ----
const YT_CHANNEL = process.env.YT_CHANNEL_ID || "UCCxbiZWKg0XgU8oAMEiSwUQ";
function decodeEntities(s) {
  return (s || "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'");
}
async function buildYoutube() {
  try {
    const res = await fetch(
      "https://www.youtube.com/feeds/videos.xml?channel_id=" + YT_CHANNEL
    );
    if (!res.ok) throw new Error("HTTP " + res.status);
    const xml = await res.text();
    const entries = xml.split("<entry>").slice(1);
    const videos = entries
      .map((e) => {
        const id = (e.match(/<yt:videoId>([^<]+)<\/yt:videoId>/) || [])[1] || "";
        const title = decodeEntities((e.match(/<title>([^<]+)<\/title>/) || [])[1] || "");
        return id ? { id, title } : null;
      })
      .filter(Boolean)
      .slice(0, 6);
    fs.writeFileSync(
      "youtube-data.json",
      JSON.stringify({ channelId: YT_CHANNEL, updated: new Date().toISOString(), videos }, null, 2)
    );
    console.log(`✅ youtube-data.json 생성 — 영상 ${videos.length}개`);
  } catch (e) {
    console.error("유튜브 피드 실패:", e.message);
    if (!fs.existsSync("youtube-data.json"))
      fs.writeFileSync(
        "youtube-data.json",
        JSON.stringify({ channelId: YT_CHANNEL, updated: null, videos: [] }, null, 2)
      );
  }
}

// 같은 빌드 내 파일명 중복 추적 (다른 파일이 같은 이름일 때만 번호 추가)
const usedFiles = new Map();

// 파일을 다운로드하여 files/ 폴더에 저장, 사이트 내 경로 반환
async function downloadFile(srcUrl, origName) {
  if (!fs.existsSync("files")) fs.mkdirSync("files");
  // 안전한 파일명 만들기 (한글/공백 → 정리, 확장자 보존)
  let ext = "";
  const m = origName.match(/\.[a-zA-Z0-9]{1,8}$/);
  if (m) ext = m[0];
  else {
    const um = srcUrl.split("?")[0].match(/\.[a-zA-Z0-9]{1,8}$/);
    if (um) ext = um[0];
  }
  // 원래 파일명을 그대로 유지 (공백 → _, 위험 문자만 제거, 한글 보존)
  const base = origName
    .replace(/\.[a-zA-Z0-9]{1,8}$/, "")
    .replace(/\s+/g, "_")
    .replace(/[^\w가-힣._-]/g, "");
  let fname = `${base}${ext}`;
  let dest = `files/${fname}`;
  // 이름은 같은데 실제로 다른 파일이면 _2, _3 … 으로만 구분
  let n = 2;
  while (usedFiles.has(dest) && usedFiles.get(dest) !== srcUrl) {
    fname = `${base}_${n}${ext}`;
    dest = `files/${fname}`;
    n++;
  }
  usedFiles.set(dest, srcUrl);
  if (fs.existsSync(dest)) return dest;

  const res = await fetch(srcUrl);
  if (!res.ok) return "";
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
  console.log(`  ↓ 첨부 저장: ${dest} (${Math.round(buf.length / 1024)}KB)`);
  return dest;
}

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return h;
}

// 페이지 본문(블록)의 텍스트를 모아서 반환
async function getPageText(pageId) {
  let lines = [];
  let cursor = undefined;
  let num = 0; // 번호 목록 카운터
  do {
    const url =
      `https://api.notion.com/v1/blocks/${pageId}/children?page_size=100` +
      (cursor ? `&start_cursor=${cursor}` : "");
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${NOTION_TOKEN}`,
        "Notion-Version": "2022-06-28",
      },
    });
    if (!res.ok) return lines.join("\n").trim();
    const data = await res.json();
    for (const b of data.results) {
      const type = b.type;
      const rich = b[type] && b[type].rich_text ? b[type].rich_text : [];
      const txt = rich.map((r) => r.plain_text).join("");
      if (type === "numbered_list_item") {
        num += 1;
        lines.push(num + ". " + txt);
      } else if (type === "bulleted_list_item") {
        num = 0;
        lines.push("• " + txt);
      } else if (type === "to_do") {
        num = 0;
        lines.push((b.to_do && b.to_do.checked ? "☑ " : "☐ ") + txt);
      } else {
        // 문단·제목·인용 등 — 빈 문단은 빈 줄로 보존(한 줄 띄우기 유지)
        num = 0;
        lines.push(txt);
      }
    }
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);
  // 빈 줄이 3줄 이상 연속이면 2줄로 정리
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

async function main() {
  const results = [];
  let cursor = undefined;

  do {
    const res = await fetch(
      `https://api.notion.com/v1/databases/${DATABASE_ID}/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${NOTION_TOKEN}`,
          "Notion-Version": "2022-06-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(cursor ? { start_cursor: cursor } : {}),
      }
    );

    if (!res.ok) {
      const text = await res.text();
      console.error("노션 API 오류:", res.status, text);
      // 오류 시 기존 파일 유지하지 않고 빈 배열 (배포는 계속됨)
      fs.writeFileSync("board-data.json", "[]");
      process.exit(0);
    }

    const data = await res.json();
    for (const page of data.results) {
      const p = page.properties || {};

      // 공개 체크박스가 꺼져 있으면 건너뜀
      const pub = findProp(p, PROP.checkbox);
      const isPublic = pub && pub.type === "checkbox" ? pub.checkbox : true;
      if (!isPublic) continue;

      // 제목
      let title = "";
      const t = findProp(p, PROP.title);
      if (t && t.type === "title" && t.title.length)
        title = t.title.map((x) => x.plain_text).join("");

      // 카테고리 (select)
      let category = "";
      const c = findProp(p, PROP.category);
      if (c && c.type === "select" && c.select) category = c.select.name;

      // 날짜
      let date = "";
      const d = findProp(p, PROP.date);
      if (d && d.type === "date" && d.date) date = d.date.start;

      // 첨부 파일 (files & media) → 빌드 시점에 다운로드하여 사이트에 저장
      // (노션 파일 URL은 1시간 후 만료되므로, 파일을 직접 받아 보관)
      let attachments = [];
      const f = findProp(p, PROP.files);
      if (f && f.type === "files") {
        for (let i = 0; i < f.files.length; i++) {
          const file = f.files[i];
          const srcUrl =
            file.type === "external"
              ? file.external.url
              : file.file
              ? file.file.url
              : "";
          if (!srcUrl) continue;
          // 외부 링크(유튜브 등)는 그대로 사용
          if (file.type === "external") {
            attachments.push(srcUrl);
            continue;
          }
          // 노션 업로드 파일은 다운로드하여 files/ 폴더에 저장
          try {
            const saved = await downloadFile(srcUrl, file.name || `file${i}`);
            if (saved) attachments.push(saved);
          } catch (e) {
            console.error("파일 다운로드 실패:", e.message);
          }
        }
      }

      // 노션 페이지 URL (영구 링크 — 만료 안 됨)
      const pageUrl = page.url || "";

      // 페이지 본문 텍스트 가져오기 (구역모임 등 글 내용)
      let content = "";
      try {
        content = await getPageText(page.id);
      } catch (e) {
        content = "";
      }

      results.push({
        title,
        category,
        date,
        attachments,
        content,
        pageUrl,
        // 링크 우선순위: 첨부파일(다운로드본) → 없으면 빈 값(본문 표시)
        url: attachments[0] || "",
      });
    }

    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);

  // 날짜 최신순 정렬
  results.sort((a, b) => (b.date || "").localeCompare(a.date || ""));

  fs.writeFileSync("board-data.json", JSON.stringify(results, null, 2));
  console.log(`✅ board-data.json 생성 완료 — 글 ${results.length}개`);
}

async function run() {
  await buildYoutube(); // 토큰 없이도 유튜브는 항상 갱신
  if (!NOTION_TOKEN) {
    console.error("⚠️  NOTION_TOKEN 환경변수가 없습니다. board-data.json을 빈 배열로 만듭니다.");
    fs.writeFileSync("board-data.json", "[]");
    return;
  }
  await main();
}

run().catch((e) => {
  console.error(e);
  if (!fs.existsSync("board-data.json")) fs.writeFileSync("board-data.json", "[]");
});
