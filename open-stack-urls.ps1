<#
.SYNOPSIS
    Opens every service URL of the stack in the default Windows browser.

.DESCRIPTION
    Run this from PowerShell to open all stack service URLs as browser tabs.

.PARAMETER List
    Only print the URLs, do not open anything.

.EXAMPLE
    .\scripts\open-stack-urls.ps1
    Opens all URLs.

.EXAMPLE
    .\scripts\open-stack-urls.ps1 -List
    Prints the URLs without opening them.
#>

[CmdletBinding()]
param(
    [switch]$List
)

$ErrorActionPreference = 'Stop'

# --- URLs to open ----------------------------------------------------------
$Urls = @(
    'https://supabase.com/'
    'https://console.upstash.com/auth/sign-in'
    'https://fly.io/'
    'https://code.visualstudio.com/download?_exp_download=fb315fc982'
    'https://vercel.com/'
    'https://github.com/'
    'https://elevenlabs.io/'
    'https://resend.com/'
    'https://platform.claude.com/'
    'https://platform.openai.com/login'
)

# --- List-only mode --------------------------------------------------------
if ($List) {
    $Urls | ForEach-Object { Write-Output $_ }
    return
}

# --- Open everything -------------------------------------------------------
Write-Host "Opening $($Urls.Count) URLs in the default browser..."
foreach ($url in $Urls) {
    Write-Host "  -> $url"
    Start-Process $url
    Start-Sleep -Milliseconds 400   # small gap so tabs are not dropped
}
Write-Host "Done."
