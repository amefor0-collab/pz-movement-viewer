param(
  [string]$SourcePath = "",
  [string]$OutputDir = "",
  [int]$TileSizePx = 512,
  [string]$TileScales = "1,0.5,0.25",
  [int]$TileQuality = 55,
  [int]$LowResMaxDimension = 4096,
  [int]$LowResQuality = 45,
  [switch]$SkipTiles,
  [switch]$SkipLowRes
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Drawing

function Resolve-SourcePath {
  param(
    [string]$ProvidedPath,
    [string]$DataDirPath
  )

  if ($ProvidedPath -and (Test-Path -LiteralPath $ProvidedPath)) {
    return (Resolve-Path -LiteralPath $ProvidedPath).Path
  }

  $candidates = @(
    (Join-Path $DataDirPath "map_latest.bmp"),
    (Join-Path $DataDirPath "PZfullmap.png")
  )

  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate) {
      return (Resolve-Path -LiteralPath $candidate).Path
    }
  }

  throw "Source map image was not found. Expected one of: map_latest.bmp, PZfullmap.png"
}

function Clamp-Int {
  param(
    [int]$Value,
    [int]$Min,
    [int]$Max
  )
  return [Math]::Min([Math]::Max($Value, $Min), $Max)
}

function Get-JpegCodec {
  $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageDecoders() |
    Where-Object { $_.MimeType -eq "image/jpeg" } |
    Select-Object -First 1

  if (-not $codec) {
    throw "JPEG codec is not available."
  }

  return $codec
}

function Save-AsJpeg {
  param(
    [System.Drawing.Image]$Image,
    [string]$Path,
    [int]$Quality,
    [System.Drawing.Imaging.ImageCodecInfo]$Codec
  )

  $safeQuality = [long](Clamp-Int -Value $Quality -Min 1 -Max 100)
  $encoderParams = New-Object System.Drawing.Imaging.EncoderParameters(1)
  $encoderParams.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter(
    [System.Drawing.Imaging.Encoder]::Quality,
    $safeQuality
  )

  try {
    $Image.Save($Path, $Codec, $encoderParams)
  }
  finally {
    $encoderParams.Dispose()
  }
}

function Resize-Bitmap {
  param(
    [System.Drawing.Image]$Source,
    [int]$Width,
    [int]$Height
  )

  $bitmap = New-Object System.Drawing.Bitmap(
    $Width,
    $Height,
    [System.Drawing.Imaging.PixelFormat]::Format24bppRgb
  )
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $graphics.DrawImage($Source, 0, 0, $Width, $Height)
  }
  finally {
    $graphics.Dispose()
  }

  return $bitmap
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = (Resolve-Path (Join-Path $scriptDir "..")).Path
$dataDir = Join-Path $projectRoot "data"
$outputRoot = if ($OutputDir) {
  $OutputDir
} else {
  Join-Path $projectRoot "public\data\map"
}

$sourceFilePath = Resolve-SourcePath -ProvidedPath $SourcePath -DataDirPath $dataDir
$sourceFileName = [System.IO.Path]::GetFileName($sourceFilePath)

New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null

$jpegCodec = Get-JpegCodec
$mapBitmap = [System.Drawing.Bitmap]::FromFile($sourceFilePath)

$lowResManifest = $null
$tileLevelsManifest = @()

try {
  $sourceWidth = $mapBitmap.Width
  $sourceHeight = $mapBitmap.Height

  if (-not $SkipLowRes) {
    $lowDir = Join-Path $outputRoot "low"
    if (Test-Path -LiteralPath $lowDir) {
      Remove-Item -LiteralPath $lowDir -Recurse -Force
    }
    New-Item -ItemType Directory -Path $lowDir -Force | Out-Null

    $resizeRatio = [Math]::Min(
      1.0,
      [Math]::Min(
        $LowResMaxDimension / [double]$sourceWidth,
        $LowResMaxDimension / [double]$sourceHeight
      )
    )
    $lowWidth = [Math]::Max(1, [int][Math]::Round($sourceWidth * $resizeRatio))
    $lowHeight = [Math]::Max(1, [int][Math]::Round($sourceHeight * $resizeRatio))
    $lowFileName = "map_low_q{0}.jpg" -f (Clamp-Int -Value $LowResQuality -Min 1 -Max 100)
    $lowPath = Join-Path $lowDir $lowFileName

    $lowBitmap = Resize-Bitmap -Source $mapBitmap -Width $lowWidth -Height $lowHeight
    try {
      Save-AsJpeg -Image $lowBitmap -Path $lowPath -Quality $LowResQuality -Codec $jpegCodec
    }
    finally {
      $lowBitmap.Dispose()
    }

    $lowResManifest = [ordered]@{
      enabled = $true
      file = "low/$lowFileName"
      width = $lowWidth
      height = $lowHeight
      maxDimension = $LowResMaxDimension
      quality = (Clamp-Int -Value $LowResQuality -Min 1 -Max 100)
    }
  } else {
    $lowResManifest = [ordered]@{
      enabled = $false
    }
  }

  if (-not $SkipTiles) {
    $tileScalesParsed = @(
      $TileScales.Split(",") |
      ForEach-Object { $_.Trim() } |
      Where-Object { $_ -ne "" } |
      ForEach-Object {
        $value = 0.0
        if ([double]::TryParse($_, [ref]$value) -and $value -gt 0) {
          [Math]::Round($value, 6)
        }
      } |
      Sort-Object -Descending -Unique
    )

    if ($tileScalesParsed.Count -eq 0) {
      throw "TileScales must contain at least one positive numeric scale."
    }

    $tilesRoot = Join-Path $outputRoot "tiles"
    if (Test-Path -LiteralPath $tilesRoot) {
      Remove-Item -LiteralPath $tilesRoot -Recurse -Force
    }
    New-Item -ItemType Directory -Path $tilesRoot -Force | Out-Null

    $levelIndex = 0
    foreach ($scale in $tileScalesParsed) {
      $levelName = "z$levelIndex"
      $levelDir = Join-Path $tilesRoot $levelName
      New-Item -ItemType Directory -Path $levelDir -Force | Out-Null

      $levelWidth = [Math]::Max(1, [int][Math]::Round($sourceWidth * $scale))
      $levelHeight = [Math]::Max(1, [int][Math]::Round($sourceHeight * $scale))

      $scaledBitmap = $null
      $ownsScaledBitmap = $false
      if ([Math]::Abs($scale - 1.0) -lt 0.000001) {
        $scaledBitmap = $mapBitmap
      } else {
        $scaledBitmap = Resize-Bitmap -Source $mapBitmap -Width $levelWidth -Height $levelHeight
        $ownsScaledBitmap = $true
      }

      try {
        $columns = [int][Math]::Ceiling($levelWidth / [double]$TileSizePx)
        $rows = [int][Math]::Ceiling($levelHeight / [double]$TileSizePx)

        for ($tileY = 0; $tileY -lt $rows; $tileY++) {
          for ($tileX = 0; $tileX -lt $columns; $tileX++) {
            $srcX = $tileX * $TileSizePx
            $srcY = $tileY * $TileSizePx
            $srcW = [Math]::Min($TileSizePx, $levelWidth - $srcX)
            $srcH = [Math]::Min($TileSizePx, $levelHeight - $srcY)
            $tileRect = New-Object System.Drawing.Rectangle($srcX, $srcY, $srcW, $srcH)
            $tileBitmap = $scaledBitmap.Clone(
              $tileRect,
              [System.Drawing.Imaging.PixelFormat]::Format24bppRgb
            )
            $tileName = "{0}_{1}.jpg" -f $tileX, $tileY
            $tilePath = Join-Path $levelDir $tileName
            try {
              Save-AsJpeg -Image $tileBitmap -Path $tilePath -Quality $TileQuality -Codec $jpegCodec
            }
            finally {
              $tileBitmap.Dispose()
            }
          }
        }

        $tileLevelsManifest += [ordered]@{
          id = $levelName
          scale = $scale
          width = $levelWidth
          height = $levelHeight
          columns = $columns
          rows = $rows
          path = "tiles/$levelName"
        }
      }
      finally {
        if ($ownsScaledBitmap -and $scaledBitmap) {
          $scaledBitmap.Dispose()
        }
      }

      $levelIndex++
    }
  }

  $manifest = [ordered]@{
    version = 1
    generatedAt = (Get-Date).ToString("o")
    source = [ordered]@{
      file = $sourceFileName
      width = $sourceWidth
      height = $sourceHeight
    }
    world = [ordered]@{
      minX = 3000
      maxX = 15000
      minY = 900
      maxY = 13500
      scalePxPerTile = 1.88
    }
    lowRes = $lowResManifest
    tiles = [ordered]@{
      enabled = (-not $SkipTiles)
      sizePx = $TileSizePx
      quality = (Clamp-Int -Value $TileQuality -Min 1 -Max 100)
      levels = $tileLevelsManifest
    }
  }

  $manifestPath = Join-Path $outputRoot "manifest.json"
  $manifestJson = $manifest | ConvertTo-Json -Depth 8
  Set-Content -LiteralPath $manifestPath -Value $manifestJson -Encoding UTF8

  Write-Output ("Source: {0}" -f $sourceFilePath)
  if (-not $SkipLowRes) {
    Write-Output ("LowRes: {0}" -f (Join-Path $outputRoot $lowResManifest.file))
  }
  if (-not $SkipTiles) {
    Write-Output ("Tiles: {0}" -f (Join-Path $outputRoot "tiles"))
    Write-Output ("Tile levels: {0}" -f ($tileLevelsManifest.Count))
  }
  Write-Output ("Manifest: {0}" -f $manifestPath)
}
finally {
  $mapBitmap.Dispose()
}
