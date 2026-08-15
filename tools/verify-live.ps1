# dsh-sound 上线验收脚本
# 检查项：1) 客户端 bundle 被服务且为新版（localStorage 后端 + radio 声音选择）
#         2) boot 图谱包含插件条目  3) 宿主端设置命名空间（rc.6 不对外暴露，仅供参考）
$ErrorActionPreference = 'Stop'

Write-Host '=== 1) client bundle ==='
$c = Invoke-WebRequest -Uri 'http://127.0.0.1:3080/plugins/dsh-sound/client.js' -UseBasicParsing -TimeoutSec 10
$isNew = $c.Content -match 'dsh-sound:config'
$hasRadio = $c.Content -match 'dns-notify-radio'
Write-Host "  status=$($c.StatusCode) bytes=$($c.RawContentLength) localStorage-backend=$isNew radio-group=$hasRadio"

Write-Host '=== 2) boot graph entry ==='
$p = Invoke-WebRequest -Uri 'http://127.0.0.1:3080/' -UseBasicParsing -TimeoutSec 10
if ($p.Content -match 'dsh-sound') { Write-Host '  boot graph includes dsh-sound' } else { Write-Host '  boot graph MISSING dsh-sound' }

Write-Host '=== 3) settings namespace (informational) ==='
$body = '{"type":"client-request","rpcId":"notify-verify-final","method":"settings.describe","payload":{}}'
$r = Invoke-WebRequest -Uri 'http://127.0.0.1:3080/api/settings.describe' -Method POST -ContentType 'application/json' -Body $body -UseBasicParsing -TimeoutSec 10
$json = $r.Content | ConvertFrom-Json
$ns = $json.result.value.namespaces | Where-Object { $_.ns -eq 'dsh-sound' }
if ($ns) { Write-Host '  dsh-sound REGISTERED (platform exposes it)' } else { Write-Host '  not exposed (expected on rc.6; client uses localStorage)' }
