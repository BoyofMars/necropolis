# out/video.webm (VP9 picture) + public/music.wav (soundtrack) -> out/necropolis.mp4
# H.264 High + AAC, the format X accepts. Uses VLC (installed), since the ffmpeg
# builds available here can't encode H.264 or audio.
param(
  [string]$Video = "$PSScriptRoot\..\out\video.webm",
  [string]$Audio = "$PSScriptRoot\..\public\music.wav",
  [string]$Out = "$PSScriptRoot\..\out\necropolis.mp4",
  [int]$Crf = 16
)
$vlc = "C:\Program Files\VideoLAN\VLC\vlc.exe"
$Video = (Resolve-Path $Video).Path
$Audio = (Resolve-Path $Audio).Path
$Out = [IO.Path]::GetFullPath($Out)
if (Test-Path $Out) { Remove-Item $Out }
$slave = "file:///" + ($Audio -replace '\\', '/')
# No fps= here: the source is already constant 60 fps, and VLC's frame-rate
# converter shifted early frames by ~40 ms against the audio.
$sout = "#transcode{vcodec=h264,venc=x264{preset=slow,crf=$Crf,profile=high,level=42,keyint=120},acodec=mp4a,ab=256,channels=2,samplerate=48000}:std{access=file,mux=mp4,dst=$Out}"
$p = Start-Process -FilePath $vlc -ArgumentList @('-I', 'dummy', '--dummy-quiet', '--play-and-exit', "--input-slave=$slave", "`"$Video`"", "--sout=`"$sout`"", 'vlc://quit') -PassThru -Wait -WindowStyle Hidden
"vlc exit $($p.ExitCode)"
Get-Item $Out | ForEach-Object { "{0} {1:N1} MB" -f $_.FullName, ($_.Length / 1MB) }
