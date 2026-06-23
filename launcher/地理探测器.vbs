' ==============================================================
'  地理探测器分析与制图平台 - 桌面启动器
'  - 隐藏控制台启动 R 后端
'  - 等待服务就绪后以「应用窗口」模式打开（无浏览器地址栏）
'  - 关闭应用窗口后，后端由心跳看门狗自动退出
' ==============================================================
Option Explicit
Dim sh, fso, appDir, rscript, url, i, ready, http, edge, cands, c
Set sh  = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

' 应用目录 = 本脚本所在目录的上一级（launcher 的父目录）
appDir = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))

' 定位 Rscript：优先随软件分发的便携 R，其次本机已安装的 R
rscript = appDir & "\R-portable\bin\Rscript.exe"
If Not fso.FileExists(rscript) Then rscript = "D:\Program Files\R\R-4.5.2\bin\Rscript.exe"
If Not fso.FileExists(rscript) Then
  MsgBox "未找到 R 运行环境。" & vbCrLf & "请确认软件目录下存在 R-portable，或本机已安装 R 4.5。", _
         vbCritical, "地理探测器"
  WScript.Quit 1
End If

url = "http://127.0.0.1:8765"

' 若服务已在运行（重复启动），直接开窗
If Not ServiceReady(url) Then
  sh.CurrentDirectory = appDir
  ' 0 = 隐藏窗口，False = 不等待
  sh.Run """" & rscript & """ """ & appDir & "\run_app.R""", 0, False
  ' 轮询等待就绪（最长约 60 秒，便携 R 冷启动较慢）
  ready = False
  For i = 1 To 120
    WScript.Sleep 500
    If ServiceReady(url) Then ready = True : Exit For
  Next
  If Not ready Then
    MsgBox "后端启动超时。" & vbCrLf & "可能缺少 R 依赖包（plumber/GD/sodium 等），请联系作者。", _
           vbCritical, "地理探测器"
    WScript.Quit 1
  End If
End If

' 以应用窗口模式打开（优先 Edge，其次 Chrome，最后默认浏览器）
edge = ""
cands = Array( _
  sh.ExpandEnvironmentStrings("%ProgramFiles(x86)%") & "\Microsoft\Edge\Application\msedge.exe", _
  sh.ExpandEnvironmentStrings("%ProgramFiles%")      & "\Microsoft\Edge\Application\msedge.exe", _
  sh.ExpandEnvironmentStrings("%ProgramFiles%")      & "\Google\Chrome\Application\chrome.exe", _
  sh.ExpandEnvironmentStrings("%ProgramFiles(x86)%") & "\Google\Chrome\Application\chrome.exe")
For Each c In cands
  If fso.FileExists(c) Then edge = c : Exit For
Next

If edge <> "" Then
  sh.Run """" & edge & """ --app=" & url & "/index.html --window-size=1440,900", 1, False
Else
  sh.Run url & "/index.html", 1, False
End If

' ---- 轮询服务是否就绪 ----
Function ServiceReady(baseUrl)
  ServiceReady = False
  On Error Resume Next
  Set http = CreateObject("MSXML2.XMLHTTP")
  http.Open "GET", baseUrl & "/api/ping", False
  http.Send
  If Err.Number = 0 Then If http.Status = 200 Then ServiceReady = True
  On Error GoTo 0
End Function
