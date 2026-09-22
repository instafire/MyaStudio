param(
    [switch]$Detach
)

$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ProjectRoot

$StudioPort = if ($env:PORT) { $env:PORT } else { "3000" }
$FeedPort = if ($env:FEED_PORT) { $env:FEED_PORT } else { "3001" }

$UserProfile = $env:USERPROFILE
$PortableNode = Join-Path $ProjectRoot ".tools\node-v22.17.0-win-x64\node.exe"
$Candidates = @(
    @{ Name = "System Node"; Path = "C:\Program Files\nodejs\node.exe"; ElectronNode = $false },
    @{ Name = "System Node (x86)"; Path = "C:\Program Files (x86)\nodejs\node.exe"; ElectronNode = $false },
    @{ Name = "Portable Node (project)"; Path = $PortableNode; ElectronNode = $false },
    @{ Name = "Antigravity"; Path = (Join-Path $UserProfile "AppData\Local\Programs\Antigravity\Antigravity.exe"); ElectronNode = $true },
    @{ Name = "Antigravity (alt)"; Path = (Join-Path $UserProfile "AppData\Local\Programs\antigravity\Antigravity.exe"); ElectronNode = $true },
    @{ Name = "Playwright Node"; Path = (Join-Path $UserProfile "AppData\Local\Programs\Python\Python311\Lib\site-packages\playwright\driver\node.exe"); ElectronNode = $false },
    @{ Name = "Playwright Node (legacy path)"; Path = "C:\Users\amn\AppData\Local\Programs\Python\Python311\Lib\site-packages\playwright\driver\node.exe"; ElectronNode = $false }
) | Where-Object { Test-Path $_.Path }

function New-ProcessInfo {
    param(
        [hashtable]$Runtime,
        [string]$Arguments,
        [bool]$RedirectOutput = $true
    )

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $Runtime.Path
    $psi.Arguments = $Arguments
    $psi.WorkingDirectory = $ProjectRoot
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $false
    $psi.RedirectStandardOutput = $RedirectOutput
    $psi.RedirectStandardError = $RedirectOutput

    if ($Runtime.ElectronNode) {
        $psi.Environment["ELECTRON_RUN_AS_NODE"] = "1"
    }

    return $psi
}

function Test-Runtime {
    param([hashtable]$Runtime)

    $psi = New-ProcessInfo -Runtime $Runtime -Arguments '-e "console.log(''RUNTIME_OK'')"'
    $proc = New-Object System.Diagnostics.Process
    $proc.StartInfo = $psi
    $null = $proc.Start()
    $stdout = $proc.StandardOutput.ReadToEnd()
    $stderr = $proc.StandardError.ReadToEnd()
    $proc.WaitForExit()

    return @{
        Runtime = $Runtime
        Success = ($proc.ExitCode -eq 0 -and $stdout -match "RUNTIME_OK")
        ExitCode = $proc.ExitCode
        Stdout = $stdout.Trim()
        Stderr = $stderr.Trim()
    }
}

function Start-Server {
    param([hashtable]$Runtime)

    if ($Detach) {
        $outLog = Join-Path $ProjectRoot ".mya-server.out.log"
        $errLog = Join-Path $ProjectRoot ".mya-server.err.log"
        if (Test-Path $outLog) { Remove-Item $outLog -Force }
        if (Test-Path $errLog) { Remove-Item $errLog -Force }

        $previousElectronMode = $env:ELECTRON_RUN_AS_NODE
        try {
            if ($Runtime.ElectronNode) {
                $env:ELECTRON_RUN_AS_NODE = "1"
            }
            $proc = Start-Process `
                -FilePath $Runtime.Path `
                -ArgumentList "server.js" `
                -WorkingDirectory $ProjectRoot `
                -RedirectStandardOutput $outLog `
                -RedirectStandardError $errLog `
                -WindowStyle Hidden `
                -PassThru
        }
        finally {
            if ($null -eq $previousElectronMode) {
                Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
            }
            else {
                $env:ELECTRON_RUN_AS_NODE = $previousElectronMode
            }
        }

        Set-Content -Path (Join-Path $ProjectRoot ".mya-server.pid") -Value $proc.Id
        Start-Sleep -Seconds 3

        if ($proc.HasExited) {
            throw "Server exited immediately. See .mya-server.out.log and .mya-server.err.log."
        }

        Write-Host "MyaStudio started with $($Runtime.Name)."
        Write-Host "Studio: http://127.0.0.1:$StudioPort"
        Write-Host "Feed:   http://127.0.0.1:$FeedPort"
        return
    }

    $psi = New-ProcessInfo -Runtime $Runtime -Arguments "server.js" -RedirectOutput:$false
    $proc = [System.Diagnostics.Process]::Start($psi)
    if (-not $proc) {
        throw "Failed to start server with $($Runtime.Name)."
    }
}

if (-not $Candidates) {
    throw "No usable JavaScript runtime was found."
}

$healthyRuntimes = @(
foreach ($candidate in $Candidates) {
    $result = Test-Runtime -Runtime $candidate
    if ($result.Success) {
        $candidate
    }
}
)

if (-not $healthyRuntimes) {
    throw "All detected JavaScript runtimes failed even for a trivial command."
}

Start-Server -Runtime $healthyRuntimes[0]
