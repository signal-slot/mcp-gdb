# Project Context: mcp-gdb

## 概要
`mcp-gdb` は、Claude などの AI アシスタントが Model Context Protocol (MCP) を介して GDB (GNU Debugger) を操作できるようにするためのサーバー実装です。

## 技術スタック
- **言語:** TypeScript
- **ランタイム:** Node.js
- **主要ライブラリ:** `@modelcontextprotocol/sdk`
- **外部依存:** `gdb` (GNU Debugger) がシステムにインストールされている必要があります。

## プロジェクト構成
- `src/index.ts`: サーバーのメイン実装。`GdbServer` クラスが MCP サーバーとして機能し、`child_process` 経由で `gdb` (MI モード) と通信します。
- `build/`: コンパイルされた JavaScript ファイルの出力先。

## 開発フロー
### ビルド
```bash
npm run build
```
TypeScript コンパイラ (`tsc`) を実行し、`build/index.js` に出力します。実行権限の付与も行われます。

### 実行
```bash
node build/index.js
```
または MCP クライアント (Claude Desktop など) から設定して呼び出します。

## アーキテクチャの要点
- **GdbServer:** MCP サーバーの主要クラス。ツールのリクエストをハンドリングします。
- **activeSessions:** `Map<string, GdbSession>` で複数の GDB セッションを管理します。
- **GDB 通信:** `gdb --interpreter=mi` を spawn し、標準入出力でやり取りします。`readline` モジュールを使用して GDB からの出力を処理しています。

## 主要なツール (Tools)
- `gdb_start`: セッション開始
- `gdb_load`: プログラムロード
- `gdb_command`: 任意の GDB コマンド実行
- その他、ブレークポイント設定、実行制御、メモリ参照などのツールが定義されています。

## 注意事項
- テストコマンドは `package.json` に定義されていません。動作確認は実際に MCP クライアント経由で行うか、手動でテストスクリプトを作成する必要があります。
