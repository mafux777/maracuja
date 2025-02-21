import { ethers } from 'ethers';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { parse } from 'csv-parse/sync';

dotenv.config();

const MNEMONIC_FILE = path.join(__dirname, '..', 'wallet-secret.txt');
const RECIPIENTS_FILE = '/Users/funkmeister380/Downloads/CM Team Cryptonomy Directory - Sheet1.csv';
const INFURA_API_KEY = process.env.INFURA_API_KEY;

interface Recipient {
    address: string;
    name: string;
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

async function main() {
    // Load recipients first
    const recipients = loadRecipients();
    console.log(`Loaded ${recipients.length} recipients:`);
    recipients.forEach(r => console.log(`- ${r.name}: ${r.address}`));

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
    
    // Get and display balance
    const balance = await provider.getBalance(connectedWallet.address);
    console.log(`Balance: ${ethers.formatEther(balance)} ETH`);

    // Validate recipient addresses
    console.log('\nValidating recipient addresses:');
    for (const recipient of recipients) {
        if (!ethers.isAddress(recipient.address)) {
            console.warn(`Warning: Invalid Ethereum address for ${recipient.name}: ${recipient.address}`);
        }
    }
}

main().catch(error => {
    console.error('Error:', error);
    process.exit(1);
});
