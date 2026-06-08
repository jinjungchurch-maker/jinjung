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

if (!NOTION_TOKEN) {
  console.error("⚠️  NOTION_TOKEN 환경변수가 없습니다. board-data.json을 빈 배열로 만듭니다.");
  fs.writeFileSync("board-data.json", "[]");
  process.exit(0);
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

      // 첨부 파일 (files & media) → URL 목록
      let attachments = [];
      const f = findProp(p, PROP.files);
      if (f && f.type === "files") {
        attachments = f.files
          .map((file) =>
            file.type === "external" ? file.external.url : file.file ? file.file.url : ""
          )
          .filter(Boolean);
      }

      results.push({
        title,
        category,
        date,
        attachments,
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

main().catch((e) => {
  console.error(e);
  fs.writeFileSync("board-data.json", "[]");
  process.exit(0);
});
