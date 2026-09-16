$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$archivePath = Join-Path ([IO.Directory]::GetParent($projectRoot).FullName) 'RoomieHub-fase-4.zip'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
Push-Location -LiteralPath $projectRoot
try {
  $sourceFiles = @(rg --files --hidden -g '!.git/**' -g '!node_modules/**' -g '!.next/**' -g '!test-results/**' -g '!playwright-report/**' -g '!*.zip' -g '!*.credentials.txt' -g '!*.tsbuildinfo')
  if ($LASTEXITCODE -ne 0) { throw 'Could not enumerate project files.' }
  if (-not ($sourceFiles -contains '.env.example')) { $sourceFiles += '.env.example' }
  $sourceFiles = @($sourceFiles | Where-Object { $_ -notmatch '(^|[\/])\.env(\.|$)' -or $_ -eq '.env.example' } | Sort-Object -Unique)
  $stream = [IO.File]::Open($archivePath, [IO.FileMode]::Create)
  $archive = [IO.Compression.ZipArchive]::new($stream, [IO.Compression.ZipArchiveMode]::Create)
  try {
    foreach ($relative in $sourceFiles) {
      $source = [IO.Path]::GetFullPath((Join-Path $projectRoot $relative))
      if (-not $source.StartsWith($projectRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'File outside project.' }
      $entryName = 'RoomieHub/' + $relative.Replace('\','/')
      [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $source, $entryName, [IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
  } finally { $archive.Dispose(); $stream.Dispose() }
  $check = [IO.Compression.ZipFile]::OpenRead($archivePath)
  try {
    $names = @($check.Entries | ForEach-Object FullName)
    if ($names -match '\.env\.local|\.credentials\.txt|node_modules/|\.next/|test-results/|\.git/') { throw 'Unexpected private/generated file in archive.' }
    foreach ($required in @('RoomieHub/package.json','RoomieHub/.env.example','RoomieHub/supabase/migrations/202609150003_organization.sql','RoomieHub/docs/phase-2-delivery.md','RoomieHub/supabase/migrations/202609150004_task_lifecycle_timezone.sql','RoomieHub/docs/phase-2-hardening.md','RoomieHub/supabase/migrations/202609150005_expenses.sql','RoomieHub/docs/phase-3-delivery.md','RoomieHub/supabase/migrations/202609150006_calendar_reservations_activities.sql','RoomieHub/docs/phase-4-delivery.md')) {
      if ($names -notcontains $required) { throw "Required file missing: $required" }
    }
    Write-Output "ZIP verified: $archivePath ($($names.Count) files, $((Get-Item -LiteralPath $archivePath).Length) bytes)"
  } finally { $check.Dispose() }
} finally { Pop-Location }
