$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
go test ./internal/protocol
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
$env:GOOS = 'windows'
$env:GOARCH = 'amd64'
$env:CGO_ENABLED = '0'
go build -buildvcs=false -trimpath -tags mygo_noinspector -ldflags '-s -w -H windowsgui -X github.com/egoist/mygo.production=1' -o out/Hey-ChatGPT.exe .
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
go build -buildvcs=false -trimpath -ldflags '-s -w -H windowsgui' -o out/hey-native-host.exe ./cmd/hey-native-host
exit $LASTEXITCODE
