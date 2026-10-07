# 箱庭

コードが生成した箱庭世界を眺めるスクリーンセーバー（作品名は未定）。構想と決定事項は [HANDOFF.md](HANDOFF.md)。

## 構成

- `index.html`：入口。three.js は import map で `vendor/three/` を読む
- `src/`：JS モジュール
  - `hash.js`：整数ハッシュと用途ごとの種
  - `field.js`：塊の大きな形（高さ）と性格（灰色か錆か）。座標だけの関数
  - `columns.js`：柱の一覧。座標と区画の量から柱の高さ・性格・暗さを決める（three.js に依存しない）
  - `state.js`：区画の量（棲むもの P・建て広げた量 S・損傷 D）。世界の時刻から決まる
  - `weather.js`：空の渦の方角と、そこからちぎれて流れてくる嵐（出現・通り道・打撃）。整数だけ
  - `atmosphere.js`：空と大気の見た目（昼夜、渦、嵐の雲と雨の幕、カメラの周りの硫酸の雨、霧と光）
  - `surface.js`：構造物の表面（継ぎ目、汚れ、覆う有機物）。世界座標の模様
  - `post.js`：画の仕上げ（トーン 3 通り、深度からの輪郭線）
  - `chunk.js`：区画の形。段 0（部品の積み重ね）〜段 4（区画 1 つの要約）
  - `view.js`：カメラからの距離で区画の段を選び、変わった区画だけ作り直す
  - `main.js`：画面、カメラ、URL の引数
- `vendor/three/`：three.js（MIT、版は `VERSION`）を同梱。CDN には頼らない
- `tools/shot.cjs`：ヘッドレス Chromium で画面を撮る
- `tools/sheet.cjs`：何枚かの画像を 1 枚に並べる（見比べ用）
- `tools/check-state.mjs`：区画の量の確認（速さ、何年経っても範囲に収まるか、1 区画の推移）。`node tools/check-state.mjs 20` で 20 年分
- `package.json`：Node で `src/` のモジュールを読むための設定だけ。依存は無い
- `.github/workflows/pages.yml`：main への push で GitHub Pages に配置
- `library/`：別作品「雪籠りの図書館」（1 ファイルで動く。Pages では `/library/`）。説明は [library/README.md](library/README.md)

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
- `view=vortex|storm`：空の渦／いちばん近い嵐を、箱庭越しに見る
- `cam=x,y,z,tx,ty,tz`：カメラの位置と注視点
- `lod=0..4`：全区画の段を固定する。同じ視点で段を変えて撮り、遠景と寄りの辻褄を比べる
- `hud=1`：世界の時刻、区画の量の平均、箱の数、段ごとの区画数を画面に出す
- `at=日時`：世界の時刻をこの日時から始める（例 `at=2027-01-24T01:01Z`）。`t` と組み合わせると撮影が再現できる
- `speed=倍率`：世界の時刻の進む速さ（例 `speed=3600` で 1 秒に 1 時間）
- `tone=real|mid|ink`：画の仕上げ（写実寄り／中間／線画寄り）。既定は real

SwiftShader は遅い。寄った画面（箱 2〜3 万個）は 1 枚に 20〜40 秒かかる。実機の負荷の目安にはならない。
