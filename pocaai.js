/* ===================================================================
   POCABINDER — 브라우저 AI 인식 엔진
   파이썬 engine.py 와 동일한 3단 파이프라인을 웹에서 그대로 재현한다.
     Stage 1  SCRFD(det_10g)  → 얼굴 검출 + 5점 랜드마크
     Stage 2  ArcFace(w600k_r50) → 512차원 임베딩 → 멤버 인덱스 코사인 매칭
     Stage 3  신뢰도 구간 판정 (자동승인 / 검수 / 반려)
   =================================================================== */
(function (global) {
'use strict';

var CFG = {
  detSize: 320,            // 기본 320 (빠름). 못 찾으면 detSizeFallback 으로 재시도
  detSizeFallback: 640,
  detThresh: 0.45,
  nmsThresh: 0.4,
  strides: [8, 16, 32],
  numAnchors: 2,
  // 파이썬 엔진과 동일한 판정 임계값
  // 후보가 6천 명대로 늘어나면서 유사도만으로는 오인식을 거를 수 없다.
  // 1순위와 2순위의 '격차'를 함께 봐야 확신 있는 판정이 된다. (실측으로 정한 값)
  simAuto: 0.44,      // 자동승인 최소 유사도
  simReview: 0.33,    // 이 미만이면 반려
  gapAuto: 0.05,      // 자동승인 최소 격차 (1순위 - 2순위)
  padSteps: [1.0, 1.8, 3.0]   // 얼굴이 화면을 꽉 채울 때 캔버스 확장 재시도
};

// ArcFace 표준 정렬 기준점 (112x112)
var ARCFACE_DST = [
  [38.2946, 51.6963], [73.5318, 51.5014], [56.0252, 71.7366],
  [41.5493, 92.3655], [70.7299, 92.2041]
];

var state = { det: null, rec: null, vecs: null, dim: 512, owner: null, meta: null, ready: false };

/* ---------------------------------------------------------- 모델 로딩 */
async function load(opts) {
  opts = opts || {};
  var base = opts.baseUrl || './';
  var onProgress = opts.onProgress || function () {};

  /* 세션 생성 실패 시(대개 멀티스레드/교차출처 문제) 단일 스레드로 한 번 더 시도한다. */
  async function makeSession(src) {
    var opt = { executionProviders: ['wasm'], graphOptimizationLevel: 'all' };
    try {
      return await ort.InferenceSession.create(src, opt);
    } catch (e1) {
      try {
        ort.env.wasm.numThreads = 1;
        ort.env.wasm.proxy = false;
        if (typeof location !== 'undefined') ort.env.wasm.wasmPaths = new URL('./', document.baseURI).href;
        return await ort.InferenceSession.create(src, opt);
      } catch (e2) {
        throw new Error((e1 && e1.message || e1) + ' / 재시도: ' + (e2 && e2.message || e2));
      }
    }
  }

  onProgress('얼굴 검출 모델 불러오는 중', 0.05);
  state.det = await makeSession(base + 'det_10g_int8.onnx');

  /* 인식 모델은 GitHub 웹 업로드 한도(25MB)를 넘지 않도록 조각으로 나뉘어 있다.
     조각을 순서대로 받아 이어붙인 뒤 메모리에서 바로 세션을 만든다.
     조각 파일이 없으면 통짜 파일로 자동 폴백한다. */
  var recBytes = null;
  try {
    var pinfo = await fetch(base + 'model_parts.json');
    if (pinfo.ok) {
      var pj = await pinfo.json();
      var spec = pj.recognition;
      var buf = new Uint8Array(spec.bytes), off = 0;
      for (var i = 0; i < spec.parts; i++) {
        onProgress('얼굴 인식 모델 불러오는 중 (' + (i + 1) + '/' + spec.parts + ')',
                   0.35 + 0.45 * (i / spec.parts));
        var pr = await fetch(base + spec.file + '.part' + i);
        if (!pr.ok) throw new Error('조각 ' + i + ' 를 받지 못했습니다');
        var ab = await pr.arrayBuffer();
        buf.set(new Uint8Array(ab), off); off += ab.byteLength;
      }
      if (off !== spec.bytes) throw new Error('모델 크기가 맞지 않습니다 (' + off + '/' + spec.bytes + ')');
      recBytes = buf;
    }
  } catch (e) {
    recBytes = null;   // 폴백
  }

  onProgress('얼굴 인식 모델 준비 중', 0.80);
  state.rec = await makeSession(recBytes ? recBytes : (base + 'w600k_r50_int8.onnx'));

  onProgress('멤버 데이터베이스 불러오는 중', 0.85);
  var mres = await fetch(base + 'index_meta.json');
  var m = await mres.json();
  state.dim = m.dim; state.owner = m.owner; state.meta = m.meta;

  // 인덱스는 int8 로 압축되어 있다 (스케일 하나로 복원). 6천여 명 × 512차원.
  var vres = await fetch(base + 'index_vecs_int8.bin');
  var vbuf = await vres.arrayBuffer();
  var q = new Int8Array(vbuf);
  var f = new Float32Array(q.length);
  for (var qi = 0; qi < q.length; qi++) f[qi] = q[qi] * m.scale;
  // 각 벡터를 다시 L2 정규화해 코사인 유사도를 내적으로 계산할 수 있게 한다
  for (var vi = 0; vi < m.count; vi++) {
    var off = vi * m.dim, nrm = 0;
    for (var k = 0; k < m.dim; k++) nrm += f[off + k] * f[off + k];
    nrm = Math.sqrt(nrm) || 1;
    for (var k2 = 0; k2 < m.dim; k2++) f[off + k2] /= nrm;
  }
  state.vecs = f;

  state.ready = true;
  onProgress('준비 완료', 1);
  return { members: Object.keys(state.meta).length, vectors: m.count };
}

/* ------------------------------------------------- 이미지 → 텐서 유틸 */
function imageToCanvas(img, pad) {
  var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
  var px = 0, py = 0;
  if (pad > 1.0) { px = Math.floor(w * (pad - 1) / 2); py = Math.floor(h * (pad - 1) / 2); }
  var c = document.createElement('canvas');
  c.width = w + px * 2; c.height = h + py * 2;
  var ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, px, py, w, h);
  return { canvas: c, offsetX: px, offsetY: py };
}

// SCRFD 입력 규격에 맞춰 종횡비 유지 레터박스
function letterbox(canvas, size) {
  var scale = Math.min(size / canvas.width, size / canvas.height);
  var nw = Math.round(canvas.width * scale), nh = Math.round(canvas.height * scale);
  var out = document.createElement('canvas');
  out.width = size; out.height = size;
  var ctx = out.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, size, size);
  ctx.drawImage(canvas, 0, 0, nw, nh);
  return { canvas: out, scale: scale };
}

// (x-127.5)/128, RGB, NCHW
function canvasToTensor(canvas, mean, std) {
  var ctx = canvas.getContext('2d', { willReadFrequently: true });
  var d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  var n = canvas.width * canvas.height;
  var f = new Float32Array(n * 3);
  for (var i = 0; i < n; i++) {
    f[i]         = (d[i * 4]     - mean) / std;  // R
    f[n + i]     = (d[i * 4 + 1] - mean) / std;  // G
    f[n * 2 + i] = (d[i * 4 + 2] - mean) / std;  // B
  }
  return new ort.Tensor('float32', f, [1, 3, canvas.height, canvas.width]);
}

/* ------------------------------------------------ Stage 1 : SCRFD 검출 */
var anchorCache = {};
function anchorCenters(h, w, stride, num) {
  var key = h + '_' + w + '_' + stride;
  if (anchorCache[key]) return anchorCache[key];
  var pts = [];
  for (var y = 0; y < h; y++)
    for (var x = 0; x < w; x++)
      for (var a = 0; a < num; a++) pts.push([x * stride, y * stride]);
  anchorCache[key] = pts;
  return pts;
}

function nms(boxes, thresh) {
  var order = boxes.map(function (b, i) { return i; })
                   .sort(function (a, b) { return boxes[b].score - boxes[a].score; });
  var keep = [];
  while (order.length) {
    var i = order.shift(); keep.push(i);
    var bi = boxes[i];
    order = order.filter(function (j) {
      var bj = boxes[j];
      var xx1 = Math.max(bi.x1, bj.x1), yy1 = Math.max(bi.y1, bj.y1);
      var xx2 = Math.min(bi.x2, bj.x2), yy2 = Math.min(bi.y2, bj.y2);
      var inter = Math.max(0, xx2 - xx1) * Math.max(0, yy2 - yy1);
      var ai = (bi.x2 - bi.x1) * (bi.y2 - bi.y1);
      var aj = (bj.x2 - bj.x1) * (bj.y2 - bj.y1);
      return inter / (ai + aj - inter) <= thresh;
    });
  }
  return keep.map(function (i) { return boxes[i]; });
}

async function detectOnce(srcCanvas, detSize) {
  var lb = letterbox(srcCanvas, detSize);
  var tensor = canvasToTensor(lb.canvas, 127.5, 128.0);
  var feeds = {}; feeds[state.det.inputNames[0]] = tensor;
  var out = await state.det.run(feeds);
  var names = state.det.outputNames;

  var faces = [];
  for (var s = 0; s < CFG.strides.length; s++) {
    var stride = CFG.strides[s];
    var score = out[names[s]];                       // (n,1)
    var bbox  = out[names[s + 3]];                   // (n,4)  거리(스트라이드 단위)
    var kps   = out[names[s + 6]];                   // (n,10)
    var fm = detSize / stride;
    var centers = anchorCenters(fm, fm, stride, CFG.numAnchors);

    for (var i = 0; i < score.data.length; i++) {
      var sc = score.data[i];
      if (sc < CFG.detThresh) continue;
      var cx = centers[i][0], cy = centers[i][1];
      var b = bbox.data;
      var x1 = cx - b[i * 4]     * stride, y1 = cy - b[i * 4 + 1] * stride;
      var x2 = cx + b[i * 4 + 2] * stride, y2 = cy + b[i * 4 + 3] * stride;
      var pts = [];
      for (var k = 0; k < 5; k++) {
        pts.push([(cx + kps.data[i * 10 + k * 2] * stride) / lb.scale,
                  (cy + kps.data[i * 10 + k * 2 + 1] * stride) / lb.scale]);
      }
      faces.push({ x1: x1 / lb.scale, y1: y1 / lb.scale,
                   x2: x2 / lb.scale, y2: y2 / lb.scale, score: sc, kps: pts });
    }
  }
  return nms(faces, CFG.nmsThresh);
}

async function detectFaces(img) {
  var sizes = [CFG.detSize];
  if (CFG.detSizeFallback && CFG.detSizeFallback !== CFG.detSize) sizes.push(CFG.detSizeFallback);
  var W = img.naturalWidth || img.width, H = img.naturalHeight || img.height;
  var total = W * H;

  for (var si = 0; si < sizes.length; si++) {
    for (var p = 0; p < CFG.padSteps.length; p++) {
      var c = imageToCanvas(img, CFG.padSteps[p]);
      var faces = await detectOnce(c.canvas, sizes[si]);
      if (!faces.length) continue;
      faces.forEach(function (f) {
        f.x1 -= c.offsetX; f.x2 -= c.offsetX;
        f.y1 -= c.offsetY; f.y2 -= c.offsetY;
        f.kps = f.kps.map(function (k) { return [k[0] - c.offsetX, k[1] - c.offsetY]; });
        f.areaRatio = ((f.x2 - f.x1) * (f.y2 - f.y1)) / total;
      });
      faces.sort(function (a, b) { return b.areaRatio - a.areaRatio; });
      return { faces: faces, pad: CFG.padSteps[p], detSize: sizes[si],
               source: c.canvas, offsetX: c.offsetX, offsetY: c.offsetY };
    }
  }
  return { faces: [], pad: null, source: null, offsetX: 0, offsetY: 0 };
}


/* ----------------------------- Stage 2 : 5점 정렬(norm_crop) + 임베딩 */
/* 최소제곱 유사변환 — skimage SimilarityTransform(=insightface norm_crop) 과 동일.
   회전+등방배율+평행이동만 허용(반사 없음). 2D에서는 닫힌 해가 존재한다:
       x' = a*x - b*y + tx
       y' = b*x + a*y + ty
   중심을 맞춘 뒤 a, b 를 직접 구하면 된다. */
function similarityTransform(src, dst) {
  var n = src.length, i;
  var mx=0, my=0, MX=0, MY=0;
  for (i=0;i<n;i++){ mx+=src[i][0]; my+=src[i][1]; MX+=dst[i][0]; MY+=dst[i][1]; }
  mx/=n; my/=n; MX/=n; MY/=n;

  var num_a=0, num_b=0, den=0;
  for (i=0;i<n;i++){
    var x=src[i][0]-mx, y=src[i][1]-my;
    var X=dst[i][0]-MX, Y=dst[i][1]-MY;
    num_a += x*X + y*Y;
    num_b += x*Y - y*X;
    den   += x*x + y*y;
  }
  if (den === 0) return [1,0,0, 0,1,0];
  var a = num_a/den, b = num_b/den;

  return [
     a, -b, MX - (a*mx - b*my),
     b,  a, MY - (b*mx + a*my)
  ];
}

function normCrop(srcCanvas, kps) {
  var M = similarityTransform(kps, ARCFACE_DST);
  var out = document.createElement('canvas');
  out.width = 112; out.height = 112;
  var ctx = out.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 112, 112);
  ctx.setTransform(M[0], M[3], M[1], M[4], M[2], M[5]);
  ctx.drawImage(srcCanvas, 0, 0);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return out;
}

async function embed(crop112) {
  var tensor = canvasToTensor(crop112, 127.5, 127.5);
  var feeds = {}; feeds[state.rec.inputNames[0]] = tensor;
  var out = await state.rec.run(feeds);
  var v = out[state.rec.outputNames[0]].data;
  var norm = 0; for (var i = 0; i < v.length; i++) norm += v[i]*v[i];
  norm = Math.sqrt(norm);
  var e = new Float32Array(v.length);
  for (var i = 0; i < v.length; i++) e[i] = v[i] / norm;
  return e;
}

/* ---------------------------------- Stage 2b : 멤버 인덱스 코사인 매칭 */
function queryMembers(emb, topk) {
  topk = topk || 5;
  var dim = state.dim, n = state.vecs.length / dim;
  var best = {};                                  // uid -> 최고 유사도
  for (var i = 0; i < n; i++) {
    var s = 0, off = i * dim;
    for (var j = 0; j < dim; j++) s += state.vecs[off + j] * emb[j];
    var uid = state.owner[i];
    if (best[uid] === undefined || s > best[uid]) best[uid] = s;
  }
  var arr = Object.keys(best).map(function (uid) {
    var m = state.meta[uid] || {};
    return { uid: +uid, similarity: Math.round(best[uid] * 10000) / 10000,
             name: m.name, name_en: m.name_en, group: m.group };
  });
  arr.sort(function (a, b) { return b.similarity - a.similarity; });
  return arr.slice(0, topk);
}

/* --------------------------------------------------- 품질 검사 (보조) */
function assessQuality(img, face) {
  var c = document.createElement('canvas');
  var W = Math.min(img.naturalWidth || img.width, 640);
  var scale = W / (img.naturalWidth || img.width);
  c.width = W; c.height = Math.round((img.naturalHeight || img.height) * scale);
  var ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, c.width, c.height);
  var d = ctx.getImageData(0, 0, c.width, c.height).data;

  // 그레이 + 라플라시안 분산 (선명도)
  var g = new Float32Array(c.width * c.height);
  for (var i = 0; i < g.length; i++)
    g[i] = 0.299*d[i*4] + 0.587*d[i*4+1] + 0.114*d[i*4+2];
  var sum = 0, sum2 = 0, cnt = 0;
  for (var y = 1; y < c.height-1; y++) {
    for (var x = 1; x < c.width-1; x++) {
      var k = y*c.width + x;
      var lap = -4*g[k] + g[k-1] + g[k+1] + g[k-c.width] + g[k+c.width];
      sum += lap; sum2 += lap*lap; cnt++;
    }
  }
  var varLap = cnt ? (sum2/cnt - (sum/cnt)*(sum/cnt)) : 0;
  var sharp = Math.max(0, Math.min(1, Math.log10(varLap + 1) / 3));

  var bright = 0; for (var i = 0; i < g.length; i++) bright += g[i];
  bright /= g.length;
  var expo = 1 - Math.min(1, Math.abs(bright - 128) / 128);

  var faceScore = face ? Math.min(1, Math.sqrt(face.areaRatio) / 0.45) : 0;
  var score = Math.round((sharp*0.45 + expo*0.25 + faceScore*0.30) * 100);
  return { score: score, sharpness: Math.round(sharp*100), exposure: Math.round(expo*100),
           faceSize: Math.round(faceScore*100), laplacianVar: Math.round(varLap) };
}

/* 코사인 유사도를 사람이 읽는 신뢰도(%)로 환산.
   구간별 선형 매핑이라 유사도 순서는 그대로 보존되며,
   제품 규칙("90% 이상 자동승인")과 실제 임계값(0.35)이 정확히 일치하도록 맞췄다.
     ~0.15  →  0%      0.28 →  70%   (반려 경계)
      0.35  → 90%      0.65 →  99%   (자동승인 경계) */
function similarityToConfidence(sim) {
  var pts = [[0.20, 0], [CFG.simReview, 70], [CFG.simAuto, 90], [0.68, 99]];
  if (sim <= pts[0][0]) return 0;
  for (var i = 1; i < pts.length; i++) {
    if (sim <= pts[i][0]) {
      var t = (sim - pts[i-1][0]) / (pts[i][0] - pts[i-1][0]);
      return Math.round(pts[i-1][1] + t * (pts[i][1] - pts[i-1][1]));
    }
  }
  return 99;
}

/* ------------------------------------------------------ 전체 파이프라인 */
async function analyze(img, onStage) {
  onStage = onStage || function () {};
  if (!state.ready) throw new Error('모델이 아직 준비되지 않았습니다');
  var t0 = performance.now();

  onStage('detect');
  var det = await detectFaces(img);
  if (!det.faces.length) {
    return { ok: true, faceFound: false, elapsedMs: Math.round(performance.now()-t0),
             decision: 'reject', reason: '사진에서 얼굴을 찾지 못했습니다' };
  }
  var face = det.faces[0];

  onStage('embed');
  var crop = normCrop(det.source, face.kps.map(function (k) {
    return [k[0] + det.offsetX, k[1] + det.offsetY];
  }));
  var emb = await embed(crop);

  onStage('match');
  var cands = queryMembers(emb, 5);
  var top = cands[0] || null;

  onStage('quality');
  var quality = assessQuality(img, face);

  var sim = top ? top.similarity : 0;
  var gap = (cands.length > 1) ? (sim - cands[1].similarity) : 1;
  var decision;
  if (sim >= CFG.simAuto && gap >= CFG.gapAuto) decision = 'auto';
  else if (sim >= CFG.simReview) decision = 'review';
  else decision = 'reject';
  var conf = similarityToConfidence(sim);
  // 격차가 좁으면 확신을 낮춰 표시한다 (2순위와 헷갈리는 상태)
  if (gap < CFG.gapAuto) conf = Math.min(conf, 89);

  return {
    ok: true, faceFound: true,
    face: { box: [Math.round(face.x1), Math.round(face.y1), Math.round(face.x2), Math.round(face.y2)],
            score: Math.round(face.score*1000)/1000, areaRatio: Math.round(face.areaRatio*1e4)/1e4 },
    faceCount: det.faces.length,
    candidates: cands,
    top: top,
    similarity: sim,
    margin: Math.round(gap*10000)/10000,
    confidence: conf,
    decision: decision,
    quality: quality,
    cropDataUrl: crop.toDataURL('image/jpeg', 0.85),
    elapsedMs: Math.round(performance.now()-t0)
  };
}

global.PocaAI = { load: load, analyze: analyze, detectFaces: detectFaces,
                  queryMembers: queryMembers, embed: embed, normCrop: normCrop,
                  config: CFG, _state: state };

})(window);
