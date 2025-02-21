import { ethers } from 'ethers';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { parse } from 'csv-parse/sync';

dotenv.config();

const MNEMONIC_FILE = path.join(__dirname, '..', 'wallet-secret.txt');
const RECIPIENTS_FILE = '/Users/funkmeister380/Downloads/CM Team Cryptonomy Directory - Sheet1.csv';
const INFURA_API_KEY = process.env.INFURA_API_KEY;
const CMCT_ADDRESS = '0x04f9f765c751845ECBeE2Ef52eFb3ca4f9faaF2D';

// ERC-20 minimal ABI for balance checking
const ERC20_ABI = [
    'function balanceOf(address owner) view returns (uint256)',
    'function decimals() view returns (uint8)',
    'function symbol() view returns (string)'
];

interface Recipient {
    address: string;
    name: string;
    ethBalance?: string;
    tokenBalance?: string;
}

function loadRecipients(): Recipient[] {
    const fileContent = fs.readFileSync(RECIPIENTS_FILE, 'utf-8');
    const records = parse(fileContent, {
        columns: true,
        skip_empty_lines: true
    });

    return records
        .filter((record: any) => record['Address'])
        .map((record: any) => ({
            address: record['Address'],
            name: record['Name'] || 'Unknown'
        }));
}

async function checkBalances(
    provider: ethers.Provider,
    recipients: Recipient[]
): Promise<void> {
    const tokenContract = new ethers.Contract(CMCT_ADDRESS, ERC20_ABI, provider);
    
    // Get token details
    const symbol = await tokenContract.symbol();
    const decimals = await tokenContract.decimals();

    console.log('\nFetching balances...');
    
    for (const recipient of recipients) {
        if (!ethers.isAddress(recipient.address)) {
            console.warn(`Warning: Invalid Ethereum address for ${recipient.name}: ${recipient.address}`);
            continue;
        }

        try {
            // Get ETH balance
            const ethBalance = await provider.getBalance(recipient.address);
            recipient.ethBalance = `${ethers.formatEther(ethBalance)} ETH`;

            // Get token balance
            const tokenBalance = await tokenContract.balanceOf(recipient.address);
            recipient.tokenBalance = `${ethers.formatUnits(tokenBalance, decimals)} ${symbol}`;
        } catch (error) {
            console.error(`Error checking balance for ${recipient.name}:`, error);
        }
    }
}

// Add function to find recipient by name
function findRecipientByName(recipients: Recipient[], searchName: string): Recipient | null {
    const matches = recipients.filter(r => 
        r.name.toLowerCase().includes(searchName.toLowerCase())
    );

    if (matches.length === 0) {
        console.error(`No recipient found with name containing "${searchName}"`);
        return null;
    }
    if (matches.length > 1) {
        console.error(`Multiple recipients found with name containing "${searchName}":`);
        matches.forEach(m => console.log(`- ${m.name}`));
        return null;
    }
    return matches[0];
}

async function sendTokens(
    wallet: ethers.HDNodeWallet | ethers.Wallet,
    recipient: Recipient,
    amount: number
): Promise<string> {
    const tokenContract = new ethers.Contract(CMCT_ADDRESS, [
        ...ERC20_ABI,
        'function transfer(address to, uint256 amount) returns (bool)'
    ], wallet);
    
    const decimals = await tokenContract.decimals();
    const symbol = await tokenContract.symbol();
    
    // Convert amount to token units
    const tokenAmount = ethers.parseUnits(amount.toString(), decimals);
    
    console.log(`\nSending ${amount} ${symbol} to ${recipient.name} (${recipient.address})`);
    const tx = await tokenContract.transfer(recipient.address, tokenAmount);
    console.log('Transaction sent, waiting for confirmation...');
    
    const receipt = await tx.wait();
    return receipt.hash;
}

async function displayBalance(recipient: Recipient, provider: ethers.Provider): Promise<void> {
    const tokenContract = new ethers.Contract(CMCT_ADDRESS, ERC20_ABI, provider);
    const decimals = await tokenContract.decimals();
    const symbol = await tokenContract.symbol();
    
    const ethBalance = await provider.getBalance(recipient.address);
    const tokenBalance = await tokenContract.balanceOf(recipient.address);
    
    console.log(`\nBalance for ${recipient.name} (${recipient.address}):`);
    console.log(`ETH: ${ethers.formatEther(ethBalance)} ETH`);
    console.log(`${symbol}: ${ethers.formatUnits(tokenBalance, decimals)} ${symbol}`);
}

async function main() {
    const command = process.argv[2];
    if (!command) {
        console.error('Please specify a command: check or send');
        process.exit(1);
    }

    // Load recipients first
    const recipients = loadRecipients();
    
    // Connect to Sepolia testnet
    const provider = new ethers.JsonRpcProvider(`https://sepolia.infura.io/v3/${INFURA_API_KEY}`);
    
    let wallet: ethers.HDNodeWallet;
    
    // Check if mnemonic file exists
    if (!fs.existsSync(MNEMONIC_FILE)) {
        // Generate new wallet
        const randomWallet = ethers.Wallet.createRandom();
        if (!randomWallet.mnemonic) {
            throw new Error('Failed to generate wallet with mnemonic');
        }
        // Create HD wallet from mnemonic
        const hdNode = ethers.HDNodeWallet.fromMnemonic(randomWallet.mnemonic);
        if (!hdNode.mnemonic) {
            throw new Error('Failed to create HD wallet with mnemonic');
        }
        wallet = hdNode;
        
        // Save mnemonic to file
        fs.writeFileSync(MNEMONIC_FILE, hdNode.mnemonic.phrase, 'utf8');
        console.log('New wallet created and mnemonic saved to wallet-secret.txt');
    } else {
        // Load existing mnemonic
        const mnemonic = fs.readFileSync(MNEMONIC_FILE, 'utf8').trim();
        wallet = ethers.HDNodeWallet.fromPhrase(mnemonic);
        console.log('Loaded existing wallet from mnemonic');
    }

    // Connect wallet to provider
    const connectedWallet = wallet.connect(provider);
    
    // Get and display address
    console.log(`\nWallet address: ${connectedWallet.address}`);
    
    // Get and display ETH balance
    const balance = await provider.getBalance(connectedWallet.address);
    console.log(`ETH Balance: ${ethers.formatEther(balance)} ETH`);

    // Add our wallet to the recipients list
    recipients.unshift({
        name: 'Our Wallet',
        address: connectedWallet.address
    });

    switch (command.toLowerCase()) {
        case 'check':
            await checkBalances(provider, recipients);
            console.log('\nBalances:');
            console.table(recipients, ['name', 'address', 'ethBalance', 'tokenBalance']);
            break;

        case 'send': {
            const recipientName = process.argv[3];
            const amount = parseFloat(process.argv[4]);

            if (!recipientName || isNaN(amount)) {
                console.error('Usage: send <recipient_name> <amount>');
                process.exit(1);
            }

            const recipient = findRecipientByName(recipients, recipientName);
            if (!recipient) {
                process.exit(1);
            }

            // Display balance before
            console.log('\nBalance before transfer:');
            await displayBalance(recipient, provider);
            
            // Send tokens
            const txHash = await sendTokens(connectedWallet, recipient, amount);
            console.log(`\nTransaction successful!`);
            console.log(`View on Etherscan: https://sepolia.etherscan.io/tx/${txHash}`);
            
            // Display balance after
            console.log('\nBalance after transfer:');
            await displayBalance(recipient, provider);
            break;
        }

        default:
            console.error('Unknown command. Use "check" or "send"');
            process.exit(1);
    }
}

main().catch(error => {
    console.error('Error:', error);
    process.exit(1);
});
