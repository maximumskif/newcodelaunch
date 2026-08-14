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
from dataclasses import dataclass
from typing import Any, Optional

_CONTRACT_NAME_PATTERN = re.compile(r"\bcontract\s+([A-Za-z_][A-Za-z0-9_]*)")


class UnknownTemplateError(ValueError):
    pass


class MissingParametersError(ValueError):
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

contract {{TOKEN_NAME}} is IERC20 {
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

contract {{TOKEN_NAME}} {
    string public name = "{{TOKEN_NAME}}";
    string public symbol = "{{TOKEN_SYMBOL}}";
    uint8 public decimals = {{TOKEN_DECIMALS}};
    uint256 private _totalSupply = {{TOKEN_SUPPLY}} * 10**{{TOKEN_DECIMALS}};

    mapping(address => uint256) private _balances;
    mapping(address => mapping(address => uint256)) private _allowances;
    mapping(address => bool) private _isExcludedFromFees;

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

    modifier onlyOwner() {
        require(msg.sender == owner, "Not the owner");
        _;
    }

    constructor() {
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

            if (recipient != address(this)) {
                require(_balances[recipient] + amount <= maxWalletAmount, "Wallet amount exceeds maximum");
            }
        }

        uint256 taxAmount = 0;

        if (!_isExcludedFromFees[sender] && !_isExcludedFromFees[recipient]) {
            if (sender == address(this)) {
                taxAmount = (amount * buyTaxRate) / 10000;
            } else if (recipient == address(this)) {
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

contract {{COLLECTION_NAME}} is IERC721, IERC165 {
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
            {"name": "TOKEN_NAME", "type": "string", "required": True, "description": "Token name (must be a valid Solidity identifier — letters/digits/underscore, no spaces)"},
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
            {"name": "TOKEN_NAME", "type": "string", "required": True, "description": "Token name (must be a valid Solidity identifier)"},
            {"name": "TOKEN_SYMBOL", "type": "string", "required": True},
            {"name": "TOKEN_DECIMALS", "type": "uint8", "required": True, "default": 18},
            {"name": "TOKEN_SUPPLY", "type": "uint256", "required": True},
            {"name": "BUY_TAX", "type": "uint256", "required": True, "default": 300, "description": "Buy tax in basis points (300 = 3%)"},
            {"name": "SELL_TAX", "type": "uint256", "required": True, "default": 500, "description": "Sell tax in basis points (500 = 5%)"},
            {"name": "MARKETING_FEE", "type": "uint256", "required": True, "default": 60, "description": "Marketing fee percentage of tax"},
            {"name": "LIQUIDITY_FEE", "type": "uint256", "required": True, "default": 40, "description": "Liquidity fee percentage of tax"},
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
            {"name": "COLLECTION_NAME", "type": "string", "required": True, "description": "NFT collection name (must be a valid Solidity identifier)"},
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


def render_contract(template_id: str, parameters: dict[str, Any]) -> dict[str, Any]:
    """Substitute {{PARAM}} placeholders and return the ready-to-compile source."""
    template = get_template(template_id)
    if template is None:
        raise UnknownTemplateError(f"Unknown template: {template_id}")

    required = [p["name"] for p in template.deployment_params if p.get("required")]
    missing = [name for name in required if name not in parameters]
    if missing:
        raise MissingParametersError(f"Missing required parameters: {', '.join(missing)}")

    contract_code = template.solidity_code
    for name, value in parameters.items():
        contract_code = contract_code.replace(f"{{{{{name}}}}}", str(value))

    # Read the real contract name back out of the rendered source instead of
    # guessing from the template's display name — the old code guessed and
    # only worked because of a `next(iter(...))` fallback when the guess
    # didn't match; this is correct without needing that fallback.
    match = _CONTRACT_NAME_PATTERN.search(contract_code)
    contract_name = match.group(1) if match else template.name.replace(" ", "")

    return {"contract_code": contract_code, "contract_name": contract_name, "template": template}
