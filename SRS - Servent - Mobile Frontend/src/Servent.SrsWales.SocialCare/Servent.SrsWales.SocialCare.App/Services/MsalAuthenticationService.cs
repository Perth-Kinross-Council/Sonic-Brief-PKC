using System.Diagnostics;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using Microsoft.AspNetCore.Components.Authorization;
using Microsoft.Extensions.Configuration;
using Microsoft.Identity.Client;

namespace Servent.SrsWales.SocialCare.App.Services;

public class MsalAuthenticationService
{
    private readonly IPublicClientApplication _authenticationClient;
    private ClaimsPrincipal _currentUser = new ClaimsPrincipal(new ClaimsIdentity());
    private readonly UserService _userService;
    private readonly IConfiguration _configuration;
    private string[] _scopes = [];

    public MsalAuthenticationService(UserService userService, IConfiguration configuration)
    {
        _configuration = configuration;
        _userService = userService;

        var clientId = _configuration.GetValue<string>("SonicBrief:EntraAppRegClientId");
        var redirectUri = $"msal{_configuration.GetValue<string>("SonicBrief:EntraAppRegClientId")}://auth";
        var authority = $"https://login.microsoftonline.com/{_configuration.GetValue<string>("SonicBrief:EntraTenantId")}";
        _scopes = _configuration.GetValue<string>("SonicBrief:EntraScopes")?.Split(',', StringSplitOptions.TrimEntries) ?? [];

        _authenticationClient = PublicClientApplicationBuilder.Create(clientId)
#if ANDROID
            .WithParentActivityOrWindow(() => Platform.CurrentActivity)
#endif
            .WithRedirectUri(redirectUri)
            .WithAuthority(authority)
            .Build();

    }

    public async Task<AuthenticationState> GetAuthenticationStateAsync()
    {
        Console.WriteLine("GetAuthenticationStateAsync called");

        try
        {
            var accounts = await _authenticationClient.GetAccountsAsync();
            var account = accounts.FirstOrDefault();
            if (account != null)
            {
                var result = await _authenticationClient
                    .AcquireTokenSilent(_scopes, account)
                    .ExecuteAsync();

                var handler = new JwtSecurityTokenHandler();
                var jwtToken = handler.ReadJwtToken(result.IdToken);
                var displayName = jwtToken.Claims.FirstOrDefault(c => c.Type == "name")?.Value ?? result.Account.Username;

                // set user service settings
                await _userService.SetEmail(result.Account.Username);
                await _userService.SetAccessToken(result.AccessToken);

                var claims = new List<Claim>
                {
                    new(ClaimTypes.Name, result.Account.Username),
                    new("AccessToken", result.AccessToken),
                    new("DisplayName", displayName),
                };

                _currentUser = new ClaimsPrincipal(new ClaimsIdentity(claims, "Custom"));
            }
            else
            {
                _currentUser = new ClaimsPrincipal(new ClaimsIdentity());
            }
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"Exception in GetAuthenticationStateAsync: {ex.Message}");
            _currentUser = new ClaimsPrincipal(new ClaimsIdentity());
        }

        Debug.WriteLine($"CurrentUser: {_currentUser?.Identity?.Name}");
        return new AuthenticationState(_currentUser);
    }

    public async Task<ClaimsPrincipal?> SignInInteractively(CancellationToken cancellationToken)
    {
        try
        {
            var result = await _authenticationClient
                .AcquireTokenInteractive(_scopes)
                .ExecuteAsync(cancellationToken);

            var handler = new JwtSecurityTokenHandler();
            var jwtToken = handler.ReadJwtToken(result.IdToken);
            var displayName = jwtToken.Claims.FirstOrDefault(c => c.Type == "name")?.Value ?? result.Account.Username;

            // set user service settings
            await _userService.SetEmail(result.Account.Username);
            await _userService.SetAccessToken(result.AccessToken);

            var claims = new List<Claim>
            {
                new(ClaimTypes.Name, result.Account.Username),
                new("AccessToken", result.AccessToken),
                new("DisplayName", displayName),
            };

            var identity = new ClaimsIdentity(claims, "Custom");
            var principal = new ClaimsPrincipal(identity);

            _currentUser = principal;

            return principal;
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"Exception in SignInInteractively: {ex.Message}");

            _currentUser = new ClaimsPrincipal(new ClaimsIdentity());

            return _currentUser;

        }
    }

    public async Task LogoutAsync(CancellationToken cancellationToken)
    {
        var accounts = await _authenticationClient.GetAccountsAsync();
        foreach (var account in accounts)
        {
            await _authenticationClient.RemoveAsync(account);
        }

        _userService.ClearAuthState();

        _currentUser = new ClaimsPrincipal(new ClaimsIdentity());
    }

    public void ForceRefresh()
    {
        Debug.WriteLine($"ForceRefresh called");
    }

    public async Task<IAccount?> FetchSignedInUserFromCache()
    {
        // get accounts from cache
        IEnumerable<IAccount> accounts = await _authenticationClient.GetAccountsAsync();

        // Error corner case: we should always have 0 or 1 accounts, not expecting > 1
        // This is just an example of how to resolve this ambiguity, which can arise if more apps share a token cache.
        // Note that some apps prefer to use a random account from the cache.
        if (accounts.Count() > 1)
        {
            foreach (var acc in accounts)
            {
                await _authenticationClient.RemoveAsync(acc);
            }

            return null;
        }

        return accounts.SingleOrDefault();
    }
}
