const { TokenListProvider } = require('@solana/spl-token-registry');

const fetchMintAddresses = async () => {
    const tokens = await new TokenListProvider().resolve();
    const tokenList = tokens.filterByChainId(8001).getList(); // Mainnet is chainId 101

    const wrappedTokens = tokenList.filter(token =>
        ['ETH', 'BTC', 'MATIC'].includes(token.symbol)
    );

    wrappedTokens.forEach(token => {
        console.log(`${token.symbol}: ${token.address}`);
    });
};

fetchMintAddresses();