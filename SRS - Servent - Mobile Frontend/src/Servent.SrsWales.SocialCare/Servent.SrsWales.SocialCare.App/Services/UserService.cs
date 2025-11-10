using System.IdentityModel.Tokens.Jwt;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace Servent.SrsWales.SocialCare.App.Services;

public class UserService
{
    private readonly IConfiguration _configuration;
    private readonly ILogger<UserService> _logger;
    private readonly string _apiBaseUrl;

    public UserService(IConfiguration configuration, ILogger<UserService> logger)
    {
        _configuration = configuration;
        _logger = logger;

        _apiBaseUrl = _configuration["SonicBrief:ApiBaseUrl"] ?? string.Empty;
    }

    public async Task<bool> IsLoggedIn()
    {
        var accessToken = await GetAccessToken();
        if (string.IsNullOrWhiteSpace(accessToken))
        {
            ClearAuthState();
            return false;
        }

        try
        {
            var handler = new JwtSecurityTokenHandler();
            var jwtToken = handler.ReadJwtToken(accessToken);
            var expClaim = jwtToken.Claims.FirstOrDefault(c => c.Type == "exp");
            if (expClaim == null)
            {
                ClearAuthState();
                return false;
            }

            var expUnix = long.Parse(expClaim.Value);
            var expDate = DateTimeOffset.FromUnixTimeSeconds(expUnix).UtcDateTime;
            var isExpired = expDate < DateTime.UtcNow;
            if (isExpired)
            {
                ClearAuthState();
                return false;
            }

            return true;
        }
        catch
        {
            ClearAuthState();
            return false;
        }
    }

    public async Task SetAccessToken(string token)
    {

        try
        {
            await SecureStorage.Default.SetAsync("access_token", token);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error setting access token in SecureStorage");
        }
    }

    public async Task<string?> GetAccessToken()
    {
        try
        {
            return await SecureStorage.Default.GetAsync("access_token");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error getting access token from SecureStorage");
            return null;
        }
    }

    public async Task SetEmail(string email)
    {
        try
        {
            await SecureStorage.Default.SetAsync("email", email);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error setting email in SecureStorage");
        }
    }

    public async Task<string?> GetEmail()
    {
        try
        {
            return await SecureStorage.Default.GetAsync("email");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error getting email from SecureStorage");
            return null;
        }
    }

    public void ClearAuthState(bool includeEmail = false)
    {
        try
        {
            SecureStorage.Default.Remove("access_token");

            if (includeEmail)
            {
                SecureStorage.Default.Remove("email");
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error clearing authentication state in SecureStorage");
        }
    }
}
