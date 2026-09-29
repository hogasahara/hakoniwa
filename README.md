# 箱庭

コードが生成した箱庭世界を眺めるスクリーンセーバー（作品名は未定）。構想と決定事項は [HANDOFF.md](HANDOFF.md)。

## 構成

- `index.html`：入口。three.js は import map で `vendor/three/` を読む
- `src/`：JS モジュール
- `vendor/three/`：three.js（MIT、版は `VERSION`）を同梱。CDN には頼らない
- `tools/shot.cjs`：ヘッドレス Chromium で画面を撮る
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

ページのエラーと警告は端末に出る。ページが `window.__hakoniwa.frames` を数え、指定の枚数を描き終えたら撮る。`shots/` は git に入れない。

URL の引数：

- `t`：画面の時刻（秒）を固定する
