# 点名页面网址与本地入口

## 真实手机点名网址

老师手机实际打开的点名网址是：

```text
https://pwa-lark-daycare-attendance.vercel.app/
```

这个网址在 `vercel.json` 里会 rewrite 到：

```text
attendance.html
```

独立点名站主要相关文件：

```text
attendance.html
js/attendance.js
attendance-sw.js
attendance.webmanifest
```

## 手机横向拉偏问题

目标行为：

- 保留旧有表格点名方式。
- 手机端允许在表格内部横向滑动来点右侧项目。
- 横向滑动时，学生名字列必须固定，不可以跟着右侧项目一起滑走。
- 页面外框和底部导航不能被拖拐或横向偏移。
- 底部导航固定在手机底部。
- 不改变点名业务逻辑。
