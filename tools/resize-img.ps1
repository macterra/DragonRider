# Resize an image to max N px (longest side) and save as JPEG.
# Usage: powershell -File tools/resize-img.ps1 in.png out.jpg 1024
param([string]$in, [string]$out, [int]$max = 1024, [long]$quality = 82)
Add-Type -AssemblyName System.Drawing
$img = [System.Drawing.Image]::FromFile($in)
$scale = [Math]::Min(1.0, $max / [Math]::Max($img.Width, $img.Height))
$w = [int]($img.Width * $scale); $h = [int]($img.Height * $scale)
$bmp = New-Object System.Drawing.Bitmap $w, $h
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
# JPEG has no alpha — flatten onto black
$g.Clear([System.Drawing.Color]::Black)
$g.DrawImage($img, 0, 0, $w, $h)
$enc = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
$ep = New-Object System.Drawing.Imaging.EncoderParameters 1
$ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality), $quality
$bmp.Save($out, $enc, $ep)
$g.Dispose(); $bmp.Dispose(); $img.Dispose()
Write-Output "$out : $w x $h, $([Math]::Round((Get-Item $out).Length/1KB)) KB"
