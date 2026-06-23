; ==============================================================
;  地理探测器分析与制图平台 - Inno Setup 安装脚本
;  生成单文件安装包（含便携 R + 应用 + 桌面/开始菜单快捷方式）
;
;  打包前准备（见 打包说明.md）：
;   1) 在本项目根目录放入便携 R：  <根>\R-portable\bin\Rscript.exe
;      且已预装依赖：plumber GD readxl jsonlite car callr later httpuv sodium
;   2) 用 Inno Setup 6 打开本文件，点击 Build（或命令行 ISCC setup.iss）
;   3) 产物在 installer\Output\ 下
;
;  注意：tools\（含私钥与 keygen）已被排除，不会打进安装包。
; ==============================================================

#define AppName "地理探测器分析与制图平台"
#define AppVer  "1.0.0"
#define AppExe  "launcher\地理探测器.vbs"
; 项目根目录（本 .iss 在 installer\ 下，根目录为上一级）
#define SrcRoot "..\"

[Setup]
AppId={{8F3A1C20-7E44-4B9C-9D21-GEODETECTORPRO}}
AppName={#AppName}
AppVersion={#AppVer}
AppPublisher=Fangster
DefaultDirName={autopf}\GeoDetectorPro
DefaultGroupName=地理探测器
DisableProgramGroupPage=yes
OutputDir=Output
OutputBaseFilename=地理探测器_安装包_v{#AppVer}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
; 便携 R 较大，允许 64 位安装目录
ArchitecturesInstallIn64BitMode=x64compatible
; 安装需要管理员（写入 Program Files）；如想免管理员改为 lowest
PrivilegesRequired=admin
; SetupIconFile=..\www\favicon.ico   ; 如有图标可启用

[Languages]
Name: "chs"; MessagesFile: "compiler:Languages\ChineseSimplified.isl"

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; GroupDescription: "附加任务:"

[Files]
; 应用核心（注意：排除 tools 私钥目录、缓存与测试文件）
Source: "{#SrcRoot}run_app.R";          DestDir: "{app}"; Flags: ignoreversion
Source: "{#SrcRoot}api\*";              DestDir: "{app}\api";      Flags: ignoreversion recursesubdirs
Source: "{#SrcRoot}www\*";              DestDir: "{app}\www";      Flags: ignoreversion recursesubdirs
Source: "{#SrcRoot}license\*";          DestDir: "{app}\license";  Flags: ignoreversion recursesubdirs
Source: "{#SrcRoot}launcher\*";         DestDir: "{app}\launcher"; Flags: ignoreversion recursesubdirs
Source: "{#SrcRoot}README.md";          DestDir: "{app}"; Flags: ignoreversion
; 便携 R（约 200~300MB，需事先放好）
Source: "{#SrcRoot}R-portable\*";       DestDir: "{app}\R-portable"; Flags: ignoreversion recursesubdirs

[Icons]
Name: "{group}\地理探测器";        Filename: "wscript.exe"; Parameters: """{app}\{#AppExe}"""; WorkingDir: "{app}"
Name: "{group}\卸载地理探测器";    Filename: "{uninstallexe}"
Name: "{autodesktop}\地理探测器";  Filename: "wscript.exe"; Parameters: """{app}\{#AppExe}"""; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "wscript.exe"; Parameters: """{app}\{#AppExe}"""; Description: "立即启动地理探测器"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; 清理运行时缓存（许可文件在 %LOCALAPPDATA%\GeoDetectorPro，按需保留/删除）
Type: filesandordirs; Name: "{app}\R-portable\.cache"
