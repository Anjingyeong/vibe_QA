import http from "node:http";
import { once } from "node:events";

const page = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;font-family:sans-serif}main{min-height:100vh}.hidden{display:none}iframe{width:10px;height:10px}</style></head>
<body><main id="app"></main><script>
const app=document.querySelector('#app');
function home(){app.innerHTML='<h1>SongSong</h1><button id="solo">혼자 시작</button><button id="friend">친구와 하기</button>';document.querySelector('#solo').onclick=game;document.querySelector('#friend').onclick=friend}
function friend(){app.innerHTML='<h1>방 설정</h1><div role="tab" tabindex="0" id="code-tab">코드 입력</div><input id="room-name" aria-label="이름"><input id="room-code" aria-label="방 코드"><button id="create">방 만들기</button><button id="join">방 입장</button><div id="state"></div>';document.querySelector('#create').onclick=create;document.querySelector('#join').onclick=join}
async function create(){const r=await fetch('/api/rooms',{method:'POST'});const x=await r.json();sessionStorage.setItem('songsong:room-session:'+x.room.code,x.playerToken);document.querySelector('#state').innerHTML='<span>친구를 기다리는 중</span><b data-room-code>'+x.room.code+'</b>'}
async function join(){const code=document.querySelector('#room-code').value;const r=await fetch('/api/rooms/'+code+'/join',{method:'POST'});document.querySelector('#state').textContent=r.ok?'2명 참가':'입장 실패'}
function game(){app.innerHTML='<section class="game-page"><div id="round">ROUND 01</div><iframe title="SongSong player" src="/song-1"></iframe><div role="status">재생 준비가 끝났습니다.</div><button id="play" aria-label="4초 음악 재생">▶ 듣기</button><input id="answer"><button id="answer-button">정답!</button><button id="next">바로 다음 곡</button></section>';document.querySelector('#play').onclick=()=>document.querySelector('[role=status]').textContent='4초 힌트를 재생하고 있습니다.';document.querySelector('#answer-button').onclick=()=>{const d=document.createElement('div');d.className='feedback-panel';d.textContent='오답';app.append(d)};document.querySelector('#next').onclick=()=>{document.querySelector('#round').textContent='ROUND 02';document.querySelector('iframe').src='/song-2'}}
function render(){if(location.hash==='#/terms')app.innerHTML='<h1>이용약관</h1>';else home()}addEventListener('hashchange',render);render();
</script></body></html>`;

function json(response, status, value) {
  response.writeHead(status, { "content-type": "application/json" }); response.end(JSON.stringify(value));
}

export async function startFlowFixture() {
  const receipt = { creates: 0, joins: 0, deletes: 0, reportMutations: 0, rooms: new Map() };
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, "http://localhost");
    if (request.method !== "GET" && /reports?/u.test(url.pathname)) receipt.reportMutations += 1;
    if (request.method === "POST" && url.pathname === "/api/rooms") {
      receipt.creates += 1; receipt.rooms.set("ABC234", "fixture-player-token");
      return json(response, 201, { room: { code: "ABC234" }, playerToken: "fixture-player-token" });
    }
    if (request.method === "POST" && /^\/api\/rooms\/[^/]+\/join$/u.test(url.pathname)) {
      const code = url.pathname.split("/")[3];
      if (!receipt.rooms.has(code)) return json(response, 404, { error: "missing" });
      receipt.joins += 1; return json(response, 200, { players: 2 });
    }
    if (request.method === "DELETE" && /^\/api\/rooms\/[^/]+$/u.test(url.pathname)) {
      const code = url.pathname.split("/")[3];
      if (request.headers.authorization !== `Bearer ${receipt.rooms.get(code)}`) return json(response, 403, {});
      receipt.rooms.delete(code); receipt.deletes += 1; return json(response, 204, null);
    }
    if (url.pathname === "/api/__vibecheck_missing__") return json(response, 404, { error: "missing" });
    if (url.pathname === "/__vibecheck_missing__") { response.writeHead(404, { "content-type": "text/html" }); return response.end(page); }
    if (url.pathname.startsWith("/song-")) { response.writeHead(200, { "content-type": "text/html" }); return response.end("<!doctype html><title>song</title>"); }
    response.writeHead(200, { "content-type": "text/html" }); response.end(page);
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const { port } = server.address();
  return { url: `http://localhost:${port}`, receipt,
    async close() { server.close(); await once(server, "close"); } };
}
