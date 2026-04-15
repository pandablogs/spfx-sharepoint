param(
  [Parameter(Mandatory = $true)]
  [string]$SiteUrl,

  [Parameter(Mandatory = $true)]
  [string]$ListTitle,

  [Parameter(Mandatory = $true)]
  [string]$ContentTypeName,

  [Parameter(Mandatory = $true)]
  [Guid]$ComponentId,

  [Parameter(Mandatory = $false)]
  [string]$ClientSideComponentPropertiesJson = "{}"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if (-not (Get-Module -ListAvailable -Name PnP.PowerShell)) {
  throw "PnP.PowerShell is required. Install with: Install-Module PnP.PowerShell -Scope CurrentUser"
}

Connect-PnPOnline -Url $SiteUrl -Interactive

$list = Get-PnPList -Identity $ListTitle
if (-not $list) { throw "List not found: $ListTitle" }

$cts = Get-PnPContentType -List $list
$ct = $cts | Where-Object { $_.Name -eq $ContentTypeName } | Select-Object -First 1
if (-not $ct) { throw "Content type not found on list: $ContentTypeName" }

$payload = @{
  NewFormClientSideComponentId     = $ComponentId
  EditFormClientSideComponentId    = $ComponentId
  DisplayFormClientSideComponentId = $ComponentId
  ClientSideComponentProperties    = $ClientSideComponentPropertiesJson
}

Set-PnPContentType -Identity $ct -List $list @payload

Write-Host "Associated Form Customizer to content type." -ForegroundColor Green
Write-Host "SiteUrl: $SiteUrl"
Write-Host "List: $ListTitle"
Write-Host "ContentType: $ContentTypeName"
Write-Host "ComponentId: $ComponentId"

