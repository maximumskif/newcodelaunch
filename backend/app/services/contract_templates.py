"""
Solidity contract templates.

Ported from the old root-level contract_templates.py, keeping only the 3 of
10 templates that were actually complete (erc20_basic, erc20_advanced,
erc721_basic) — the other 7 were `pass` stubs that returned None and would
crash `generate_contract()` if selected.

The old templates also stored an `abi` and `bytecode` field per template, but
the deployer (services/solidity.py in this rebuild, smart_contract_deployer.py
in the old app) always recompiles from `solidity_code` via solcx rather than
using those stored fields — they were dead weight (and for 2 of the 3
templates, outright fake: `abi=[]` and a truncated placeholder bytecode
string). Dropped here; ABI/bytecode always come from a real compile.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from typing import Any, Optional

from eth_utils import is_hex_address, to_checksum_address

_CONTRACT_NAME_PATTERN = re.compile(r"\bcontract\s+([A-Za-z_][A-Za-z0-9_]*)")


class UnknownTemplateError(ValueError):
    pass


class TemplateParameterError(ValueError):
    """Base for anything wrong with a template's parameters — routes map it
    to a 400 without needing to know which specific problem it was."""


class MissingParametersError(TemplateParameterError):
    pass


class InvalidParametersError(TemplateParameterError):
    pass


@dataclass
class ContractTemplate:
    id: str
    name: str
    type: str  # 'erc20' | 'erc721'
    description: str
    solidity_code: str
    deployment_params: list[dict[str, Any]]
    features: list[str]
    gas_estimate: int

    def to_dict(self, include_source: bool = False) -> dict[str, Any]:
        data = {
            "id": self.id,
            "name": self.name,
            "type": self.type,
            "description": self.description,
            "deployment_params": self.deployment_params,
            "features": self.features,
            "gas_estimate": self.gas_estimate,
        }
        if include_source:
            data["solidity_code"] = self.solidity_code
        return data


_ERC20_BASIC_SOURCE = '''
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

interface IERC20 {
    function totalSupply() external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address recipient, uint256 amount) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool);

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
}

contract {{CONTRACT_NAME}} is IERC20 {
    string public name = "{{TOKEN_NAME}}";
    string public symbol = "{{TOKEN_SYMBOL}}";
    uint8 public decimals = {{TOKEN_DECIMALS}};
    uint256 private _totalSupply = {{TOKEN_SUPPLY}} * 10**{{TOKEN_DECIMALS}};

    mapping(address => uint256) private _balances;
    mapping(address => mapping(address => uint256)) private _allowances;

    address public owner;

    modifier onlyOwner() {
        require(msg.sender == owner, "Not the owner");
        _;
    }

    constructor() {
        owner = msg.sender;
        _balances[owner] = _totalSupply;
        emit Transfer(address(0), owner, _totalSupply);
    }

    function totalSupply() public view override returns (uint256) {
        return _totalSupply;
    }

    function balanceOf(address account) public view override returns (uint256) {
        return _balances[account];
    }

    function transfer(address recipient, uint256 amount) public override returns (bool) {
        _transfer(msg.sender, recipient, amount);
        return true;
    }

    function allowance(address owner, address spender) public view override returns (uint256) {
        return _allowances[owner][spender];
    }

    function approve(address spender, uint256 amount) public override returns (bool) {
        _approve(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address sender, address recipient, uint256 amount) public override returns (bool) {
        _transfer(sender, recipient, amount);

        uint256 currentAllowance = _allowances[sender][msg.sender];
        require(currentAllowance >= amount, "ERC20: transfer amount exceeds allowance");
        _approve(sender, msg.sender, currentAllowance - amount);

        return true;
    }

    function _transfer(address sender, address recipient, uint256 amount) internal {
        require(sender != address(0), "ERC20: transfer from the zero address");
        require(recipient != address(0), "ERC20: transfer to the zero address");

        uint256 senderBalance = _balances[sender];
        require(senderBalance >= amount, "ERC20: transfer amount exceeds balance");
        _balances[sender] = senderBalance - amount;
        _balances[recipient] += amount;

        emit Transfer(sender, recipient, amount);
    }

    function _approve(address owner, address spender, uint256 amount) internal {
        require(owner != address(0), "ERC20: approve from the zero address");
        require(spender != address(0), "ERC20: approve to the zero address");

        _allowances[owner][spender] = amount;
        emit Approval(owner, spender, amount);
    }

    function mint(address to, uint256 amount) public onlyOwner {
        _totalSupply += amount;
        _balances[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function burn(uint256 amount) public {
        require(_balances[msg.sender] >= amount, "ERC20: burn amount exceeds balance");
        _balances[msg.sender] -= amount;
        _totalSupply -= amount;
        emit Transfer(msg.sender, address(0), amount);
    }
}
'''

_ERC20_ADVANCED_SOURCE = '''
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

contract {{CONTRACT_NAME}} {
    string public name = "{{TOKEN_NAME}}";
    string public symbol = "{{TOKEN_SYMBOL}}";
    uint8 public decimals = {{TOKEN_DECIMALS}};
    uint256 private _totalSupply = {{TOKEN_SUPPLY}} * 10**{{TOKEN_DECIMALS}};

    mapping(address => uint256) private _balances;
    mapping(address => mapping(address => uint256)) private _allowances;
    mapping(address => bool) private _isExcludedFromFees;
    // DEX pair contracts (e.g. the Uniswap/PancakeSwap pair for this token)
    // registered by the owner: buying is a transfer *from* a pair, selling
    // is a transfer *to* one. Before this, "buy"/"sell" meant a transfer
    // from/to this token contract itself — which no DEX trade ever is, so
    // the advertised taxes never applied where they'd matter.
    mapping(address => bool) public marketPairs;

    address public owner;
    address public marketingWallet;
    address public liquidityWallet;

    uint256 public buyTaxRate = {{BUY_TAX}};
    uint256 public sellTaxRate = {{SELL_TAX}};
    uint256 public marketingFee = {{MARKETING_FEE}};
    uint256 public liquidityFee = {{LIQUIDITY_FEE}};

    bool public tradingEnabled = false;
    uint256 public maxTransactionAmount = {{MAX_TX_AMOUNT}} * 10**{{TOKEN_DECIMALS}};
    uint256 public maxWalletAmount = {{MAX_WALLET_AMOUNT}} * 10**{{TOKEN_DECIMALS}};

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event TaxCollected(uint256 amount, string taxType);
    event MarketPairSet(address indexed pair, bool isPair);
    event OwnershipRenounced(address indexed previousOwner);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not the owner");
        _;
    }

    constructor() {
        // Same caps the owner setters enforce — a deploy used to accept any
        // tax (up to 100%), and a marketing share over 100 made every taxed
        // transfer revert (the liquidity share underflowed).
        require(buyTaxRate <= 1000 && sellTaxRate <= 1000, "Tax cannot exceed 10%");
        require(marketingFee <= 100, "Marketing fee is a percentage of the tax (0-100)");
        // The split is computed as marketing + "the rest"; requiring the
        // stated liquidity share to be that rest keeps what the deployer
        // entered true (30 used to quietly mean 40 next to a 60).
        require(marketingFee + liquidityFee == 100, "Marketing and liquidity fees must add up to 100");
        owner = msg.sender;
        marketingWallet = {{MARKETING_WALLET}};
        liquidityWallet = {{LIQUIDITY_WALLET}};

        _isExcludedFromFees[owner] = true;
        _isExcludedFromFees[address(this)] = true;
        _isExcludedFromFees[marketingWallet] = true;
        _isExcludedFromFees[liquidityWallet] = true;

        _balances[owner] = _totalSupply;
        emit Transfer(address(0), owner, _totalSupply);
    }

    function totalSupply() public view returns (uint256) {
        return _totalSupply;
    }

    function balanceOf(address account) public view returns (uint256) {
        return _balances[account];
    }

    function transfer(address recipient, uint256 amount) public returns (bool) {
        _transfer(msg.sender, recipient, amount);
        return true;
    }

    function allowance(address owner, address spender) public view returns (uint256) {
        return _allowances[owner][spender];
    }

    function approve(address spender, uint256 amount) public returns (bool) {
        _approve(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address sender, address recipient, uint256 amount) public returns (bool) {
        _transfer(sender, recipient, amount);

        uint256 currentAllowance = _allowances[sender][msg.sender];
        require(currentAllowance >= amount, "ERC20: transfer amount exceeds allowance");
        _approve(sender, msg.sender, currentAllowance - amount);

        return true;
    }

    function _transfer(address sender, address recipient, uint256 amount) internal {
        require(sender != address(0), "ERC20: transfer from the zero address");
        require(recipient != address(0), "ERC20: transfer to the zero address");
        require(amount > 0, "Transfer amount must be greater than zero");

        if (!tradingEnabled) {
            require(_isExcludedFromFees[sender] || _isExcludedFromFees[recipient], "Trading not enabled");
        }

        if (!_isExcludedFromFees[sender] && !_isExcludedFromFees[recipient]) {
            require(amount <= maxTransactionAmount, "Transfer amount exceeds maximum");

            // A pair holds the pool's whole side of liquidity — capping it
            // like a wallet would make every sell revert once the pool grew.
            if (recipient != address(this) && !marketPairs[recipient]) {
                require(_balances[recipient] + amount <= maxWalletAmount, "Wallet amount exceeds maximum");
            }
        }

        uint256 taxAmount = 0;

        if (!_isExcludedFromFees[sender] && !_isExcludedFromFees[recipient]) {
            if (marketPairs[sender]) {
                taxAmount = (amount * buyTaxRate) / 10000;
            } else if (marketPairs[recipient]) {
                taxAmount = (amount * sellTaxRate) / 10000;
            }
        }

        uint256 transferAmount = amount - taxAmount;

        require(_balances[sender] >= amount, "ERC20: transfer amount exceeds balance");
        _balances[sender] -= amount;
        _balances[recipient] += transferAmount;

        if (taxAmount > 0) {
            uint256 marketingAmount = (taxAmount * marketingFee) / 100;
            uint256 liquidityAmount = taxAmount - marketingAmount;

            _balances[marketingWallet] += marketingAmount;
            _balances[liquidityWallet] += liquidityAmount;

            emit Transfer(sender, marketingWallet, marketingAmount);
            emit Transfer(sender, liquidityWallet, liquidityAmount);
            emit TaxCollected(taxAmount, "Transfer Tax");
        }

        emit Transfer(sender, recipient, transferAmount);
    }

    function _approve(address owner, address spender, uint256 amount) internal {
        require(owner != address(0), "ERC20: approve from the zero address");
        require(spender != address(0), "ERC20: approve to the zero address");

        _allowances[owner][spender] = amount;
        emit Approval(owner, spender, amount);
    }

    function enableTrading() external onlyOwner {
        tradingEnabled = true;
    }

    function updateTaxRates(uint256 _buyTax, uint256 _sellTax) external onlyOwner {
        require(_buyTax <= 1000 && _sellTax <= 1000, "Tax cannot exceed 10%");
        buyTaxRate = _buyTax;
        sellTaxRate = _sellTax;
    }

    function updateWallets(address _marketing, address _liquidity) external onlyOwner {
        require(_marketing != address(0) && _liquidity != address(0), "Wallets cannot be the zero address");
        marketingWallet = _marketing;
        liquidityWallet = _liquidity;
    }

    function updateLimits(uint256 _maxTx, uint256 _maxWallet) external onlyOwner {
        maxTransactionAmount = _maxTx * 10**decimals;
        maxWalletAmount = _maxWallet * 10**decimals;
    }

    function excludeFromFees(address account, bool excluded) external onlyOwner {
        _isExcludedFromFees[account] = excluded;
    }

    function isExcludedFromFees(address account) external view returns (bool) {
        return _isExcludedFromFees[account];
    }

    function setMarketPair(address pair, bool isPair) external onlyOwner {
        require(pair != address(0), "Pair cannot be the zero address");
        marketPairs[pair] = isPair;
        emit MarketPairSet(pair, isPair);
    }

    // Gives up every owner power for good: taxes, limits, wallets, and
    // pairs are then fixed as they are. Trading must already be enabled —
    // renouncing first would leave the token untradable forever.
    function renounceOwnership() external onlyOwner {
        require(tradingEnabled, "Enable trading before renouncing ownership");
        emit OwnershipRenounced(owner);
        owner = address(0);
    }
}
'''

_ERC721_BASIC_SOURCE = '''
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

interface IERC165 {
    function supportsInterface(bytes4 interfaceId) external view returns (bool);
}

interface IERC721 {
    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId);
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);

    function balanceOf(address owner) external view returns (uint256 balance);
    function ownerOf(uint256 tokenId) external view returns (address owner);
    function safeTransferFrom(address from, address to, uint256 tokenId, bytes calldata data) external;
    function safeTransferFrom(address from, address to, uint256 tokenId) external;
    function transferFrom(address from, address to, uint256 tokenId) external;
    function approve(address to, uint256 tokenId) external;
    function setApprovalForAll(address operator, bool approved) external;
    function getApproved(uint256 tokenId) external view returns (address operator);
    function isApprovedForAll(address owner, address operator) external view returns (bool);
}

contract {{CONTRACT_NAME}} is IERC721, IERC165 {
    string public name = "{{COLLECTION_NAME}}";
    string public symbol = "{{COLLECTION_SYMBOL}}";
    uint256 public totalSupply = 0;
    uint256 public maxSupply = {{MAX_SUPPLY}};
    uint256 public mintPrice = {{MINT_PRICE}};
    string public baseURI = "{{BASE_URI}}";

    address public owner;
    bool public mintingEnabled = false;
    uint256 public maxMintsPerWallet = {{MAX_MINTS_PER_WALLET}};

    mapping(uint256 => address) private _owners;
    mapping(address => uint256) private _balances;
    mapping(uint256 => address) private _tokenApprovals;
    mapping(address => mapping(address => bool)) private _operatorApprovals;
    mapping(address => uint256) public mintedCount;

    modifier onlyOwner() {
        require(msg.sender == owner, "Not the owner");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function supportsInterface(bytes4 interfaceId) public view virtual override returns (bool) {
        return
            interfaceId == type(IERC721).interfaceId ||
            interfaceId == type(IERC165).interfaceId;
    }

    function balanceOf(address owner) public view virtual override returns (uint256) {
        require(owner != address(0), "ERC721: address zero is not a valid owner");
        return _balances[owner];
    }

    function ownerOf(uint256 tokenId) public view virtual override returns (address) {
        address owner = _ownerOf(tokenId);
        require(owner != address(0), "ERC721: invalid token ID");
        return owner;
    }

    function _ownerOf(uint256 tokenId) internal view virtual returns (address) {
        return _owners[tokenId];
    }

    function tokenURI(uint256 tokenId) public view virtual returns (string memory) {
        _requireMinted(tokenId);
        return bytes(baseURI).length > 0 ? string(abi.encodePacked(baseURI, toString(tokenId), ".json")) : "";
    }

    function approve(address to, uint256 tokenId) public virtual override {
        address owner = ownerOf(tokenId);
        require(to != owner, "ERC721: approval to current owner");
        require(
            msg.sender == owner || isApprovedForAll(owner, msg.sender),
            "ERC721: approve caller is not token owner or approved for all"
        );

        _approve(to, tokenId);
    }

    function getApproved(uint256 tokenId) public view virtual override returns (address) {
        _requireMinted(tokenId);
        return _tokenApprovals[tokenId];
    }

    function setApprovalForAll(address operator, bool approved) public virtual override {
        _setApprovalForAll(msg.sender, operator, approved);
    }

    function isApprovedForAll(address owner, address operator) public view virtual override returns (bool) {
        return _operatorApprovals[owner][operator];
    }

    function transferFrom(address from, address to, uint256 tokenId) public virtual override {
        require(_isApprovedOrOwner(msg.sender, tokenId), "ERC721: caller is not token owner or approved");
        _transfer(from, to, tokenId);
    }

    function safeTransferFrom(address from, address to, uint256 tokenId) public virtual override {
        safeTransferFrom(from, to, tokenId, "");
    }

    function safeTransferFrom(address from, address to, uint256 tokenId, bytes memory data) public virtual override {
        require(_isApprovedOrOwner(msg.sender, tokenId), "ERC721: caller is not token owner or approved");
        _safeTransfer(from, to, tokenId, data);
    }

    function mint(address to, uint256 quantity) public payable {
        require(mintingEnabled, "Minting not enabled");
        require(quantity > 0, "Quantity must be greater than 0");
        require(totalSupply + quantity <= maxSupply, "Exceeds maximum supply");
        require(mintedCount[to] + quantity <= maxMintsPerWallet, "Exceeds maximum mints per wallet");
        require(msg.value >= mintPrice * quantity, "Insufficient payment");

        mintedCount[to] += quantity;

        for (uint256 i = 0; i < quantity; i++) {
            uint256 tokenId = totalSupply + 1;
            totalSupply++;
            _safeMint(to, tokenId);
        }
    }

    function ownerMint(address to, uint256 quantity) public onlyOwner {
        require(totalSupply + quantity <= maxSupply, "Exceeds maximum supply");

        for (uint256 i = 0; i < quantity; i++) {
            uint256 tokenId = totalSupply + 1;
            totalSupply++;
            _safeMint(to, tokenId);
        }
    }

    function setMintingEnabled(bool enabled) public onlyOwner {
        mintingEnabled = enabled;
    }

    function setMintPrice(uint256 price) public onlyOwner {
        mintPrice = price;
    }

    function setBaseURI(string memory uri) public onlyOwner {
        baseURI = uri;
    }

    function setMaxMintsPerWallet(uint256 max) public onlyOwner {
        maxMintsPerWallet = max;
    }

    function withdraw() public onlyOwner {
        uint256 balance = address(this).balance;
        require(balance > 0, "No funds to withdraw");
        payable(owner).transfer(balance);
    }

    function _requireMinted(uint256 tokenId) internal view virtual {
        require(_exists(tokenId), "ERC721: invalid token ID");
    }

    function _exists(uint256 tokenId) internal view virtual returns (bool) {
        return _ownerOf(tokenId) != address(0);
    }

    function _isApprovedOrOwner(address spender, uint256 tokenId) internal view virtual returns (bool) {
        address owner = ownerOf(tokenId);
        return (spender == owner || isApprovedForAll(owner, spender) || getApproved(tokenId) == spender);
    }

    function _safeMint(address to, uint256 tokenId) internal virtual {
        _mint(to, tokenId);
    }

    function _mint(address to, uint256 tokenId) internal virtual {
        require(to != address(0), "ERC721: mint to the zero address");
        require(!_exists(tokenId), "ERC721: token already minted");

        _balances[to] += 1;
        _owners[tokenId] = to;

        emit Transfer(address(0), to, tokenId);
    }

    function _transfer(address from, address to, uint256 tokenId) internal virtual {
        require(ownerOf(tokenId) == from, "ERC721: transfer from incorrect owner");
        require(to != address(0), "ERC721: transfer to the zero address");

        _approve(address(0), tokenId);

        _balances[from] -= 1;
        _balances[to] += 1;
        _owners[tokenId] = to;

        emit Transfer(from, to, tokenId);
    }

    function _approve(address to, uint256 tokenId) internal virtual {
        _tokenApprovals[tokenId] = to;
        emit Approval(ownerOf(tokenId), to, tokenId);
    }

    function _setApprovalForAll(address owner, address operator, bool approved) internal virtual {
        require(owner != operator, "ERC721: approve to caller");
        _operatorApprovals[owner][operator] = approved;
        emit ApprovalForAll(owner, operator, approved);
    }

    function _safeTransfer(address from, address to, uint256 tokenId, bytes memory data) internal virtual {
        _transfer(from, to, tokenId);
    }

    function toString(uint256 value) internal pure returns (string memory) {
        if (value == 0) {
            return "0";
        }
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) {
            digits++;
            temp /= 10;
        }
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits -= 1;
            buffer[digits] = bytes1(uint8(48 + uint256(value % 10)));
            value /= 10;
        }
        return string(buffer);
    }
}
'''

_TEMPLATES: dict[str, ContractTemplate] = {
    "erc20_basic": ContractTemplate(
        id="erc20_basic",
        name="Basic ERC-20 Token",
        type="erc20",
        description="Standard ERC-20 token with mint and burn functionality",
        solidity_code=_ERC20_BASIC_SOURCE,
        deployment_params=[
            {"name": "TOKEN_NAME", "type": "string", "required": True, "description": "Token name, e.g. My Token"},
            {"name": "TOKEN_SYMBOL", "type": "string", "required": True, "description": "Token symbol"},
            {"name": "TOKEN_DECIMALS", "type": "uint8", "required": True, "default": 18, "description": "Token decimals"},
            {"name": "TOKEN_SUPPLY", "type": "uint256", "required": True, "description": "Initial token supply"},
        ],
        features=["ERC-20 Standard", "Mintable", "Burnable", "Owner Controls"],
        gas_estimate=1_500_000,
    ),
    "erc20_advanced": ContractTemplate(
        id="erc20_advanced",
        name="Advanced ERC-20 Token",
        type="erc20",
        description="Advanced ERC-20 with tax system, limits, and anti-whale protection",
        solidity_code=_ERC20_ADVANCED_SOURCE,
        deployment_params=[
            {"name": "TOKEN_NAME", "type": "string", "required": True, "description": "Token name, e.g. My Token"},
            {"name": "TOKEN_SYMBOL", "type": "string", "required": True},
            {"name": "TOKEN_DECIMALS", "type": "uint8", "required": True, "default": 18},
            {"name": "TOKEN_SUPPLY", "type": "uint256", "required": True},
            {"name": "BUY_TAX", "type": "uint256", "required": True, "default": 300, "max": 1000, "description": "Buy tax in basis points (300 = 3%, max 1000 = 10%)"},
            {"name": "SELL_TAX", "type": "uint256", "required": True, "default": 500, "max": 1000, "description": "Sell tax in basis points (500 = 5%, max 1000 = 10%)"},
            {"name": "MARKETING_FEE", "type": "uint256", "required": True, "default": 60, "max": 100, "description": "Marketing share of the tax, in percent (the rest goes to liquidity)"},
            {"name": "LIQUIDITY_FEE", "type": "uint256", "required": True, "default": 40, "max": 100, "description": "Liquidity share of the tax, in percent (marketing + liquidity must equal 100)"},
            {"name": "MAX_TX_AMOUNT", "type": "uint256", "required": True, "description": "Maximum transaction amount"},
            {"name": "MAX_WALLET_AMOUNT", "type": "uint256", "required": True, "description": "Maximum wallet amount"},
            {"name": "MARKETING_WALLET", "type": "address", "required": True, "description": "Marketing wallet address"},
            {"name": "LIQUIDITY_WALLET", "type": "address", "required": True, "description": "Liquidity wallet address"},
        ],
        features=["Tax System", "Anti-Whale Protection", "Trading Controls", "Fee Distribution", "Owner Controls"],
        gas_estimate=2_500_000,
    ),
    "erc721_basic": ContractTemplate(
        id="erc721_basic",
        name="Basic ERC-721 NFT Collection",
        type="erc721",
        description="Standard ERC-721 NFT collection with minting functionality",
        solidity_code=_ERC721_BASIC_SOURCE,
        deployment_params=[
            {"name": "COLLECTION_NAME", "type": "string", "required": True, "description": "NFT collection name, e.g. My Collection"},
            {"name": "COLLECTION_SYMBOL", "type": "string", "required": True, "description": "NFT collection symbol"},
            {"name": "MAX_SUPPLY", "type": "uint256", "required": True, "description": "Maximum NFT supply"},
            {"name": "MINT_PRICE", "type": "uint256", "required": True, "description": "Mint price in wei"},
            {"name": "BASE_URI", "type": "string", "required": True, "description": "Base URI for metadata"},
            {"name": "MAX_MINTS_PER_WALLET", "type": "uint256", "required": True, "default": 10, "description": "Maximum mints per wallet"},
        ],
        features=["ERC-721 Standard", "Public Minting", "Owner Minting", "Metadata Support", "Withdraw Funds"],
        gas_estimate=3_500_000,
    ),
}


def get_template(template_id: str) -> Optional[ContractTemplate]:
    return _TEMPLATES.get(template_id)


def get_all_templates(contract_type: Optional[str] = None) -> list[ContractTemplate]:
    templates = list(_TEMPLATES.values())
    if contract_type:
        templates = [t for t in templates if t.type == contract_type]
    return templates


# Which display-name parameter each template's {{CONTRACT_NAME}} identifier
# is derived from.
_DISPLAY_NAME_PARAM = {"erc20": "TOKEN_NAME", "erc721": "COLLECTION_NAME"}

# Identifiers a derived contract name must not collide with: the interfaces
# these templates declare themselves, plus Solidity keywords/reserved words
# that are plausible as a one-word token name.
_RESERVED_IDENTIFIERS = {
    "IERC20", "IERC721", "IERC165", "contract", "interface", "library", "function", "event", "error",
    "modifier", "mapping", "struct", "enum", "address", "string", "bytes", "bool", "public", "private",
    "internal", "external", "return", "returns", "if", "else", "for", "while", "do", "break",
    "continue", "new", "delete", "true", "false", "this", "super", "import", "pragma", "constant",
    "immutable", "payable", "view", "pure", "virtual", "override", "abstract", "emit", "type",
    "unchecked", "assembly", "try", "catch", "revert", "require", "assert", "constructor", "fallback",
    "receive", "wei", "gwei", "ether", "seconds", "minutes", "hours", "days", "weeks", "years",
}

_UINT_BITS = {"uint8": 8, "uint256": 256}
_MAX_STRING_LENGTH = 256


def contract_identifier(display_name: str, fallback: str) -> str:
    """"My Cool Apes" -> "MyCoolApes": a valid, non-reserved Solidity
    identifier derived from a human display name, so the name itself can
    contain spaces/punctuation. Accents are folded to ASCII first
    ("Café" -> "Cafe"); anything left that isn't [A-Za-z0-9_] is dropped."""
    ascii_name = unicodedata.normalize("NFKD", display_name).encode("ascii", "ignore").decode("ascii")
    words = re.findall(r"[A-Za-z0-9_]+", ascii_name)
    identifier = "".join(word[:1].upper() + word[1:] for word in words)
    if not identifier:
        identifier = fallback
    if identifier[0].isdigit():
        identifier = f"{fallback}{identifier}"
    if identifier in _RESERVED_IDENTIFIERS:
        identifier = f"{identifier}{fallback}"
    return identifier


def _solidity_string_literal(value: str) -> str:
    """A complete, safely-escaped Solidity string literal (quotes included).
    Plain "..." for printable ASCII; unicode"..." when the value has any
    non-ASCII character (a plain literal can't hold one)."""
    escaped = value.replace("\\", "\\\\").replace('"', '\\"')
    prefix = "" if escaped.isascii() else "unicode"
    return f'{prefix}"{escaped}"'


def _coerce_parameter(param: dict[str, Any], value: Any) -> str:
    """Validates one parameter against its declared type and returns the
    Solidity source text to substitute for it. Values are never pasted into
    the source raw: before this, a `"` in a string parameter closed the
    literal early and whatever followed compiled as contract code, and a
    space in a name broke the contract declaration outright."""
    name, param_type = param["name"], param["type"]

    if param_type == "string":
        if not isinstance(value, str) or not value.strip():
            raise InvalidParametersError(f"{name} must be a non-empty string")
        value = value.strip()
        if len(value) > _MAX_STRING_LENGTH:
            raise InvalidParametersError(f"{name} must be at most {_MAX_STRING_LENGTH} characters")
        if any(unicodedata.category(ch).startswith("C") for ch in value):
            raise InvalidParametersError(f"{name} must not contain control characters or line breaks")
        return _solidity_string_literal(value)

    if param_type in _UINT_BITS:
        # bool is an int subclass — True must not silently become 1.
        if isinstance(value, bool) or not isinstance(value, (int, str)):
            raise InvalidParametersError(f"{name} must be a whole number")
        text = str(value).strip()
        if not text.isdigit():
            raise InvalidParametersError(f"{name} must be a whole number")
        if int(text) >= 2 ** _UINT_BITS[param_type]:
            raise InvalidParametersError(f"{name} is too large for a {param_type}")
        # A template's own on-chain cap (e.g. taxes), checked before a wallet
        # prompt rather than surfacing as a reverted deploy.
        if "max" in param and int(text) > param["max"]:
            raise InvalidParametersError(f"{name} can be at most {param['max']}")
        return str(int(text))

    if param_type == "address":
        if not isinstance(value, str) or not is_hex_address(value.strip()):
            raise InvalidParametersError(f"{name} must be a 0x-prefixed, 40-hex-character address")
        # Solidity rejects a non-checksummed address literal outright — a
        # lowercase address pasted from anywhere used to fail compilation.
        return to_checksum_address(value.strip())

    raise InvalidParametersError(f"{name} has an unsupported type: {param_type}")


def render_contract(template_id: str, parameters: dict[str, Any]) -> dict[str, Any]:
    """Validate parameters against the template's declared types, fill in
    defaults, and return the ready-to-compile source."""
    template = get_template(template_id)
    if template is None:
        raise UnknownTemplateError(f"Unknown template: {template_id}")

    # A caller-controlled JSON value — e.g. a list containing the required
    # param names as strings — can pass the `name not in parameters`
    # membership check below (list membership, not dict-key membership)
    # without actually being a dict, and then crash `.items()` further down
    # with an unhandled AttributeError. Both /compile and /estimate reach
    # this function unauthenticated, so this must fail clean, not crash.
    if not isinstance(parameters, dict):
        raise MissingParametersError("parameters must be an object of PARAM_NAME -> value")

    # A required parameter with a declared default (e.g. erc721_basic's
    # MAX_MINTS_PER_WALLET) falls back to it rather than counting as missing.
    required = [p["name"] for p in template.deployment_params if p.get("required") and p.get("default") is None]
    missing = [name for name in required if parameters.get(name) in (None, "")]
    if missing:
        raise MissingParametersError(f"Missing required parameters: {', '.join(missing)}")

    contract_code = template.solidity_code
    # Only declared parameters are substituted — an extra key (e.g. a
    # caller-supplied CONTRACT_NAME) is ignored, never pasted in.
    for param in template.deployment_params:
        value = parameters.get(param["name"])
        if value in (None, ""):
            value = param.get("default")
        if value is None:
            raise MissingParametersError(f"Missing required parameters: {param['name']}")
        rendered = _coerce_parameter(param, value)
        if param["type"] == "string":
            # String placeholders sit inside quotes in the template source;
            # replace the whole quoted placeholder with a complete literal.
            contract_code = contract_code.replace(f'"{{{{{param["name"]}}}}}"', rendered)
        contract_code = contract_code.replace(f"{{{{{param['name']}}}}}", rendered)

    display_param = _DISPLAY_NAME_PARAM[template.type]
    contract_name = contract_identifier(str(parameters[display_param]), fallback=template.type.upper())
    contract_code = contract_code.replace("{{CONTRACT_NAME}}", contract_name)

    return {"contract_code": contract_code, "contract_name": contract_name, "template": template}
