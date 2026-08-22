[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

$requiredKeys = @(
    "PERPLEXITY_API_KEY",
    "XAI_API_KEY",
    "DEEPSEEK_API_KEY"
)

$missingKeys = @(
    $requiredKeys | Where-Object {
        [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($_))
    }
)

if ($missingKeys.Count -gt 0) {
    throw "Required environment variables are missing: $($missingKeys -join ', '). No API requests were sent."
}

$secrets = @(
    [Environment]::GetEnvironmentVariable("PERPLEXITY_API_KEY"),
    [Environment]::GetEnvironmentVariable("XAI_API_KEY"),
    [Environment]::GetEnvironmentVariable("DEEPSEEK_API_KEY")
)

function Protect-Text {
    param([AllowNull()][string]$Text)

    if ([string]::IsNullOrEmpty($Text)) {
        return $Text
    }

    $safe = $Text -replace '(?i)Bearer\s+[A-Za-z0-9._~+/-]+', 'Bearer [REDACTED]'
    foreach ($secret in $secrets) {
        if (-not [string]::IsNullOrEmpty($secret)) {
            $safe = $safe.Replace($secret, "[REDACTED]")
        }
    }

    if ($safe.Length -gt 300) {
        return $safe.Substring(0, 300)
    }
    return $safe
}

function Get-JsonProperty {
    param(
        [AllowNull()]$Object,
        [Parameter(Mandatory = $true)][string]$Name
    )

    if ($null -eq $Object) {
        return $null
    }

    $property = $Object.PSObject.Properties[$Name]
    if ($null -eq $property) {
        return $null
    }

    return $property.Value
}

function Invoke-SingleApiProbe {
    param(
        [Parameter(Mandatory = $true)][string]$Provider,
        [Parameter(Mandatory = $true)][string]$Uri,
        [Parameter(Mandatory = $true)][string]$ApiKey,
        [Parameter(Mandatory = $true)][hashtable]$Payload
    )

    $result = [ordered]@{
        provider         = $Provider
        attempted        = $true
        success          = $false
        http_status      = $null
        content_type     = $null
        response_format  = $null
        top_level_fields = @()
        object           = $null
        model            = $null
        choices_count    = $null
        usage            = $null
        error            = $null
    }

    $handler = New-Object System.Net.Http.HttpClientHandler
    $client = New-Object System.Net.Http.HttpClient($handler)
    $client.Timeout = [TimeSpan]::FromSeconds(60)

    $request = New-Object System.Net.Http.HttpRequestMessage(
        [System.Net.Http.HttpMethod]::Post,
        $Uri
    )
    $request.Headers.Authorization = New-Object System.Net.Http.Headers.AuthenticationHeaderValue(
        "Bearer",
        $ApiKey
    )
    $request.Headers.Accept.Add(
        (New-Object System.Net.Http.Headers.MediaTypeWithQualityHeaderValue("application/json"))
    )

    $payloadJson = $Payload | ConvertTo-Json -Depth 10 -Compress
    $request.Content = New-Object System.Net.Http.StringContent(
        $payloadJson,
        [System.Text.Encoding]::UTF8,
        "application/json"
    )

    try {
        # Exactly one outbound request is made for this provider. There is no retry path.
        $response = $client.SendAsync($request).GetAwaiter().GetResult()
        $result.http_status = [int]$response.StatusCode

        if ($null -ne $response.Content.Headers.ContentType) {
            $result.content_type = $response.Content.Headers.ContentType.ToString()
        }

        $responseText = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
        $parsed = $null

        try {
            $parsed = $responseText | ConvertFrom-Json
            $result.response_format = "JSON object"
            $result.top_level_fields = @($parsed.PSObject.Properties.Name)
            $result.object = Get-JsonProperty -Object $parsed -Name "object"
            $result.model = Get-JsonProperty -Object $parsed -Name "model"

            $choices = Get-JsonProperty -Object $parsed -Name "choices"
            if ($null -ne $choices) {
                $result.choices_count = @($choices).Count
            }

            $result.usage = Get-JsonProperty -Object $parsed -Name "usage"
        }
        catch {
            $result.response_format = "non-JSON or invalid JSON"
        }

        $result.success = $response.IsSuccessStatusCode

        if (-not $result.success) {
            $errorObject = Get-JsonProperty -Object $parsed -Name "error"
            $errorType = Get-JsonProperty -Object $errorObject -Name "type"
            $errorCode = Get-JsonProperty -Object $errorObject -Name "code"
            $errorMessage = Get-JsonProperty -Object $errorObject -Name "message"

            if ([string]::IsNullOrWhiteSpace([string]$errorMessage)) {
                $errorMessage = "The provider returned a non-success HTTP response."
            }

            $result.error = [ordered]@{
                type    = Protect-Text ([string]$errorType)
                code    = Protect-Text ([string]$errorCode)
                message = Protect-Text ([string]$errorMessage)
            }
        }
    }
    catch {
        $result.error = [ordered]@{
            type    = $_.Exception.GetType().Name
            code    = $null
            message = Protect-Text $_.Exception.Message
        }
    }
    finally {
        if ($null -ne $request) { $request.Dispose() }
        if ($null -ne $client) { $client.Dispose() }
        if ($null -ne $handler) { $handler.Dispose() }
    }

    return [pscustomobject]$result
}

Add-Type -AssemblyName System.Net.Http

$results = @(
    Invoke-SingleApiProbe `
        -Provider "Perplexity" `
        -Uri "https://api.perplexity.ai/v1/sonar" `
        -ApiKey ([Environment]::GetEnvironmentVariable("PERPLEXITY_API_KEY")) `
        -Payload @{
            model      = "sonar"
            messages   = @(@{ role = "user"; content = "Reply OK." })
            max_tokens = 1
            stream     = $false
        }

    Invoke-SingleApiProbe `
        -Provider "xAI" `
        -Uri "https://api.x.ai/v1/chat/completions" `
        -ApiKey ([Environment]::GetEnvironmentVariable("XAI_API_KEY")) `
        -Payload @{
            model            = "grok-4.3"
            messages         = @(@{ role = "user"; content = "Reply OK." })
            max_tokens       = 1
            reasoning_effort = "none"
            stream           = $false
        }

    Invoke-SingleApiProbe `
        -Provider "DeepSeek" `
        -Uri "https://api.deepseek.com/chat/completions" `
        -ApiKey ([Environment]::GetEnvironmentVariable("DEEPSEEK_API_KEY")) `
        -Payload @{
            model      = "deepseek-v4-flash"
            messages   = @(@{ role = "user"; content = "Reply OK." })
            max_tokens = 1
            thinking   = @{ type = "disabled" }
            stream     = $false
        }
)

$projectRoot = Split-Path -Parent $PSScriptRoot
$outputDirectory = Join-Path $projectRoot "work"
$outputPath = Join-Path $outputDirectory "api-probe-result.json"

[System.IO.Directory]::CreateDirectory($outputDirectory) | Out-Null

$output = [ordered]@{
    generated_at_utc = [DateTime]::UtcNow.ToString("o")
    results          = $results
}

$json = $output | ConvertTo-Json -Depth 12
[System.IO.File]::WriteAllText(
    $outputPath,
    $json,
    (New-Object System.Text.UTF8Encoding($false))
)

Write-Host "Probe complete. Sanitized result: $outputPath"


