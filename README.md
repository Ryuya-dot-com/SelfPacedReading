# Self-Paced Reading (Jiang-style) — Experiment Notes

## 1. 目的と前提
- L2 学習者が文法知識を **自動的に運用**できているか（integrated knowledge / automatic competence）を検証する。
- 指標：逐語 self-paced reading の読時間 (RT) と、非文文での処理遅延。
- 明示的知識の介入を最小化し、処理中に自動活性化される文法知識のみを捉える設計。

## 2. 刺激と独立変数
- 操作構造（64 文）：複数形 –s（32）／動詞下位範疇化（32）。
- 各文に文法的・非文法的バージョンあり。**同一参加者が同一文の両バージョンを読むことはない**（List1/List2 でカウンターバランス）。
- 理解質問：全試行の 50%（Yes/No）。文法性とは無関係な内容理解を問う。
- 測定位置（critical regions）  
  - Pos1: エラー前（両条件同一）  
  - Pos2: エラー発生語  
  - Pos3: エラー直後（spillover 重点）  
  - Pos4: その次の語

### 操作例
- 複数形 –s（partitive: several/many/two of + 名詞のみに限定）
  - G: The visitor took several of the rare **coins** in the cabinet.
  - U: The visitor took several of the rare **coin** in the cabinet.
- 動詞下位範疇化
  - G: The teacher **wanted** the student to start all over again.
  - U: The teacher **insisted** the student to start all over again.

## 3. 刺激提示・タスク仕様
- 逐語 self-paced reading (moving window)。Space で次語を表示し、直前語は消去（再読不可）。
- 語は左→右に追加表示され、各語の RT を記録。
- 質問は出現した試行のみ F=Yes / J=No で回答。
- 休憩: 本試行で **20 試行ごとに自動休憩**。休憩直前に 3 秒の注視点、続いて「休憩です…」表示。Space で再開。
- 練習 10 試行（フィードバックあり）→ 本試行（フィードバックなし）。
- 指示: 「できるだけ速く、意味理解を優先。文法判断は不要。」

## 4. 実験フロー
1) セットアップ: 参加者名・ID入力 → JSON 読み込み  
2) 練習 10 試行（質問は必ず提示、正誤フィードバックあり）  
3) 本試行（List1/2 に基づく 128 試行; 質問は 50%）  
4) 20 試行ごとに休憩（3 秒注視点つき）  
5) 完了後、自動で結果を保存

## 5. ランダマイズとカウンターバランス
- 参加者名 + ID をハッシュし、List1/2 と乱数 Seed を自動決定（カウンターバランス目的）。  
  - 実験者が上書きする場合のみ URL で `?list=List1|List2` / `?seed=1234` を指定。
- 本試行の擬似ランダマイズ（20試行ブロックを使用）  
  - ブロックサイズ: 20（休憩単位）  
  - test_partitive / test_subcategorization / filler を残数比率に基づいて各ブロックに割当  
  - test 連続は最大3回まで（それ以上連続しないよう制約付き配置）  
  - partitive が前半に偏らないよう、各ブロックで残数比率を再計算して配分  
  - 質問付与: 前半/後半それぞれで test/filler ごとに約50%に設定（±1）。全体でもほぼ50%。
- 練習の質問出現: 10試行中 6問あり / 4問なし（ランダム順）。本番同様、質問が出る/出ない両方に慣れる。
- 試行順・質問配置は Seed に基づき再現可能。

## 6. データ出力・ログ
- 完了時に **Excel 互換 (.xlsx) を自動ダウンロード**（SpreadsheetML）。  
  - ファイル名: `SelfPacedReading_<参加者名>_<ID>_<YYYY-MM-DD_HHMMSS>.xlsx`  
  - 手動ボタン「Excelで保存」も使用可。
- 主要フィールド: `ts_iso, t_rel_ms, participant_id, participant_name, assigned_list, seed_used, phase, event(token/question), trial_index, item_id, set_id, item_type, structure, condition, has_question, token_index, token, rt_ms, question, correct_answer, response, correct`
- ブラウザ再読み込み/閉じる時は警告を出してデータ喪失を防止（完了後は解除）。

## 7. 参加者除外と処理の指針（参考）
- 理解正答率 < 80% を除外基準に（Jiang に準拠）。
- RT 外れ値: 個人平均 ±2SD、および 200ms 未満 / 2000ms 超を除外。
- 分析単位: 参加者分析 (F1/t1), 項目分析 (F2/t2)。

## 8. 使い方（最小手順）
1) `index.html` をブラウザで開く。  
2) 参加者名・IDを入力し、`jiang_full_materials_with_fillers_list1_list2.json` を読み込む。  
3) 「説明へ進む」→ 練習 → 本試行。休憩指示が出たら Space で再開。  
4) 完了すると自動で `.xlsx` がダウンロードされる。必要なら手動ボタンでも保存可能。

## 9. 再現性と注意
- 同じ参加者名・IDで再実行すると同じ List/Seed になる（カウンターバランス維持）。
- 実験中のブラウザ戻る/リロードは避ける（警告は出るが、意図せず離脱しないよう注意）。
- 刺激 JSON と `index.html`/`script.js` を同一フォルダに置くこと。  
