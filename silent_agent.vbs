' Discord PC Controller - Silent Zero-Lag Agent Launcher
Dim WShell, FSO, ScriptDir
Set WShell = CreateObject("WScript.Shell")
Set FSO = CreateObject("Scripting.FileSystemObject")

ScriptDir = FSO.GetParentFolderName(WScript.ScriptFullName)

' Run node agent.js with hidden window (0) and Below Normal CPU priority so games get 100% priority
WShell.Run "cmd.exe /c start /belowNormal /b node """ & ScriptDir & "\agent.js""", 0, False
