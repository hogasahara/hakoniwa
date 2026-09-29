# 箱庭

コードが生成した箱庭世界を眺めるスクリーンセーバー（作品名は未定）。構想と決定事項は [HANDOFF.md](HANDOFF.md)。

## 構成

- `index.html`：入口。three.js は import map で `vendor/three/` を読む
- `src/`：JS モジュール
  - `hash.js`：整数ハッシュと用途ごとの種
  - `field.js`：塊の大きな形（高さ）と性格（灰色か錆か）。座標だけの関数
  - `chunk.js`：区画の中身。段 0（部品の積み重ね）〜段 4（区画 1 つの要約）
  - `view.js`：カメラからの距離で区画の段を選び、変わった区画だけ作り直す
  - `main.js`：画面、カメラ、URL の引数
- `vendor/three/`：three.js（MIT、版は `VERSION`）を同梱。CDN には頼らない
- `tools/shot.cjs`：ヘッドレス Chromium で画面を撮る
- `tools/sheet.cjs`：何枚かの画像を 1 枚に並べる（見比べ用）
- `.github/workflows/pages.yml`：main への push で GitHub Pages に配置

ビルドは不要。JS をモジュールに分けているので `file://` では開けない。手元では静的サーバーで開く。

```sh
python3 -m http.server 8000   # http://localhost:8000/
```

## 画面の確認（GPU の無い環境）

Chromium の SwiftShader（WebGL を CPU で動かす）で描画して撮る。Playwright が要る（リポジトリの依存にはしていない）。

```sh
node tools/shot.cjs                        # shots/shot.png
node tools/shot.cjs shots/far.png "t=120"  # URL に ?t=120 を付けて撮る
node tools/shot.cjs out.png "" --size 1920x1080 --frames 5
```

ページのエラーと警告は端末に出る。ページが `window.__hakoniwa.frames` を数え、指定の枚数を描き終え、区画の作り直し（`busy`）が済んだら撮る。`shots/` は git に入れない。

```sh
node tools/sheet.cjs shots/sheet.png shots/a.png shots/b.png --cols 2 --width 1400
```

URL の引数（`src/main.js` の先頭にも書いてある）：

- `t=秒`：画面の時刻を固定する
- `view=far|mid|near`：決まった位置から見る
- `cam=x,y,z,tx,ty,tz`：カメラの位置と注視点
- `lod=0..4`：全区画の段を固定する。同じ視点で段を変えて撮り、遠景と寄りの辻褄を比べる
- `hud=1`：箱の数と段ごとの区画数を画面に出す

SwiftShader は遅い。寄った画面（箱 2〜3 万個）は 1 枚に 20〜40 秒かかる。実機の負荷の目安にはならない。
