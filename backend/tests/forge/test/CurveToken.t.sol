// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

// Tests for the Bonding-Curve Token template, rendered by ../render.py into
// src/ (four variants: default, the smallest and largest supply/target the
// backend allows, and one where nothing divides evenly). Uniswap V2 here is
// Uniswap's own published build — WETH9, the factory (whose pair bytecode
// hashes to the init-code hash Router02 hardcodes) and Router02 — read from
// the frontend's node_modules, the same artifacts the e2e chain uses.
//
// No forge-std: the cheatcodes used are declared below, so this runs with
// nothing but forge itself.

interface Vm {
    function etch(address target, bytes calldata code) external;
    function deal(address account, uint256 balance) external;
    function prank(address sender) external;
    function startPrank(address sender) external;
    function stopPrank() external;
    function getCode(string calldata artifact) external view returns (bytes memory);
    function readFile(string calldata path) external view returns (string memory);
    function parseJsonBytes(string calldata json, string calldata key) external pure returns (bytes memory);
    function expectRevert() external;
    function expectRevert(bytes calldata revertData) external;
    function assume(bool condition) external pure;
}

interface ICurve {
    function name() external view returns (string memory);
    function totalSupply() external view returns (uint256);
    function curveSupply() external view returns (uint256);
    function poolSupply() external view returns (uint256);
    function graduationTarget() external view returns (uint256);
    function virtualEth() external view returns (uint256);
    function virtualTokens() external view returns (uint256);
    function balanceOf(address) external view returns (uint256);
    function allowance(address, address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
    function approve(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
    function pair() external view returns (address);
    function ethReserve() external view returns (uint256);
    function tokensSold() external view returns (uint256);
    function graduated() external view returns (bool);
    function quoteBuy(uint256 value) external view returns (uint256 tokens, uint256 cost, uint256 fee);
    function quoteSell(uint256 tokens) external view returns (uint256 eth, uint256 fee);
    function buy(uint256 minTokens) external payable returns (uint256);
    function sell(uint256 tokens, uint256 minEth) external returns (uint256);
    function FEE_BPS() external view returns (uint256);
    function feeRecipient() external view returns (address);
    function feesOwed() external view returns (uint256);
    function withdrawFees() external returns (uint256);
    function CREATOR_FEE_BPS() external view returns (uint256);
    function creator() external view returns (address);
    function creatorFeesOwed() external view returns (uint256);
    function claimCreatorFees() external returns (uint256);
}

interface IFactory {
    function getPair(address, address) external view returns (address);
    function createPair(address, address) external returns (address);
}

interface IPair {
    function token0() external view returns (address);
    function getReserves() external view returns (uint112, uint112, uint32);
    function totalSupply() external view returns (uint256);
    function balanceOf(address) external view returns (uint256);
    function sync() external;
    function mint(address to) external returns (uint256);
}

interface IWETH9 {
    function deposit() external payable;
    function transfer(address, uint256) external returns (bool);
    function balanceOf(address) external view returns (uint256);
}

interface IRouter {
    function swapExactETHForTokens(uint256 amountOutMin, address[] calldata path, address to, uint256 deadline)
        external
        payable
        returns (uint256[] memory);
    function swapExactTokensForETH(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 deadline)
        external
        returns (uint256[] memory);
    function addLiquidityETH(
        address token,
        uint256 amountTokenDesired,
        uint256 amountTokenMin,
        uint256 amountETHMin,
        address to,
        uint256 deadline
    ) external payable returns (uint256, uint256, uint256);
}

Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

address constant FACTORY = 0x00000000000000000000000000000000000fAc70;
address constant WETH = 0x0000000000000000000000000000000000057e70;
address constant DEAD = 0x000000000000000000000000000000000000dEaD;
address constant FEE_RECIPIENT = 0x000000000000000000000000000000000000FEE0;
string constant UNISWAP = "../../../frontend/node_modules/@uniswap/";

function toString(uint256 value) pure returns (string memory) {
    if (value == 0) return "0";
    uint256 digits;
    for (uint256 v = value; v != 0; v /= 10) digits++;
    bytes memory buffer = new bytes(digits);
    for (; value != 0; value /= 10) buffer[--digits] = bytes1(uint8(48 + (value % 10)));
    return string(buffer);
}

function assertEq(uint256 a, uint256 b, string memory what) pure {
    if (a != b) revert(string.concat(what, ": ", toString(a), " != ", toString(b)));
}

function assertLe(uint256 a, uint256 b, string memory what) pure {
    if (a > b) revert(string.concat(what, ": ", toString(a), " > ", toString(b)));
}

function assertTrue(bool condition, string memory what) pure {
    if (!condition) revert(what);
}

// Deploys Uniswap V2 at the addresses the rendered curves have baked in.
abstract contract WithUniswap {
    IRouter router;

    function _create(bytes memory code, uint256 value) internal returns (address deployed) {
        assembly {
            deployed := create(value, add(code, 0x20), mload(code))
        }
        require(deployed != address(0), "create failed");
    }

    function _artifact(string memory path) internal view returns (bytes memory) {
        return vm.parseJsonBytes(vm.readFile(string.concat(UNISWAP, path)), ".bytecode");
    }

    function _deployUniswap() internal {
        vm.etch(WETH, _create(_artifact("v2-periphery/build/WETH9.json"), 0).code);
        vm.etch(FACTORY, _create(abi.encodePacked(_artifact("v2-core/build/UniswapV2Factory.json"), abi.encode(address(this))), 0).code);
        router = IRouter(_create(abi.encodePacked(_artifact("v2-periphery/build/UniswapV2Router02.json"), abi.encode(FACTORY, WETH)), 0));
    }
}

// Re-enters the curve when it's paid, to show the lock holds.
contract Reenterer {
    ICurve curve;
    bool public reentryFailed;

    constructor(ICurve curve_) {
        curve = curve_;
    }

    function buy() external payable {
        curve.buy{value: msg.value}(0);
    }

    function sellAll() external {
        curve.sell(curve.balanceOf(address(this)), 0);
    }

    receive() external payable {
        try curve.buy{value: 0}(0) {} catch {
            reentryFailed = true;
        }
    }
}

contract Deployer {
    function deploy(bytes memory code) external returns (address deployed) {
        assembly {
            deployed := create(0, add(code, 0x20), mload(code))
        }
        require(deployed != address(0), "create failed");
    }
}

// Refuses ETH: a buyer that can't take a refund, or a seller that can't be paid.
contract NoEth {
    function buy(ICurve curve) external payable {
        curve.buy{value: msg.value}(0);
    }
}

abstract contract CurveTest is WithUniswap {
    ICurve curve;
    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    address carol = address(0xCA201);

    function variant() internal pure virtual returns (string memory);

    function setUp() public {
        _deployUniswap();
        curve = _deployCurve(0);
        vm.deal(alice, 1e30);
        vm.deal(bob, 1e30);
        vm.deal(carol, 1e30);
    }

    function _deployCurve(uint256 creatorBuy) internal returns (ICurve) {
        return ICurve(_create(vm.getCode(string.concat(variant(), ".sol:", variant())), creatorBuy));
    }

    function _target() internal view returns (uint256) {
        return curve.graduationTarget();
    }

    function _buy(address who, uint256 eth) internal returns (uint256) {
        vm.prank(who);
        return curve.buy{value: eth}(0);
    }

    function _sell(address who, uint256 tokens) internal returns (uint256) {
        vm.prank(who);
        return curve.sell(tokens, 0);
    }

    function _reserves() internal view returns (uint256 tokenReserve, uint256 wethReserve) {
        IPair pair = IPair(curve.pair());
        (uint112 r0, uint112 r1, ) = pair.getReserves();
        (tokenReserve, wethReserve) = pair.token0() == address(curve) ? (uint256(r0), uint256(r1)) : (uint256(r1), uint256(r0));
    }

    // Both shares of the fee still in the curve: the platform's and the creator's.
    function _fees(ICurve c) internal view returns (uint256) {
        return c.feesOwed() + c.creatorFeesOwed();
    }

    function _sellEth(uint256 tokens) internal view returns (uint256 eth) {
        (eth, ) = curve.quoteSell(tokens);
    }

    // Curve price in wei per whole token, scaled by 1e18 for precision.
    function _curvePrice() internal view returns (uint256) {
        return ((curve.virtualEth() + curve.ethReserve()) * 1e36) / (curve.virtualTokens() - curve.tokensSold());
    }

    // ── Setup ──────────────────────────────────────────────────────────────

    function test_wholeSupplyStartsInTheCurve_andThePairExists() public {
        assertEq(curve.balanceOf(address(curve)), curve.totalSupply(), "curve holds the supply");
        assertEq(curve.curveSupply() + curve.poolSupply(), curve.totalSupply(), "curve + pool = supply");
        assertEq(curve.curveSupply() * 5, curve.totalSupply() * 4, "80% on the curve");
        assertTrue(curve.pair() != address(0), "pair created");
        assertTrue(IFactory(FACTORY).getPair(address(curve), WETH) == curve.pair(), "pair is the factory's");
        assertEq(curve.ethReserve(), 0, "nothing raised");
        (uint256 tokenReserve, uint256 wethReserve) = _reserves();
        assertEq(tokenReserve + wethReserve, 0, "pool empty");
    }

    function test_plainEthTransfersAreRefused() public {
        vm.prank(alice);
        (bool ok, ) = address(curve).call{value: 1 ether}("");
        assertTrue(!ok, "plain ETH accepted");
    }

    // ── Buying out the curve ───────────────────────────────────────────────

    function test_buyingTheWholeCurveGraduatesIntoABurnedPool() public {
        uint256 before = alice.balance;
        uint256 lastPrice;
        // Most of the way in one buy, so the last-token price can be read.
        _buy(alice, (_target() * 99) / 100);
        lastPrice = _curvePrice();
        _buy(alice, _target()); // overshoots: refunded
        uint256 paid = before - alice.balance;

        assertTrue(curve.graduated(), "graduated");
        assertEq(curve.balanceOf(alice), curve.curveSupply(), "alice holds every curve token");
        assertEq(paid, curve.ethReserve() + _fees(curve), "paid what was raised plus the fee (overshoot refunded)");
        _assertOnePercent(_fees(curve), curve.ethReserve(), "fees on the buy-out");
        // Raised within 0.0001% of the target.
        uint256 raised = curve.ethReserve();
        uint256 diff = raised > _target() ? raised - _target() : _target() - raised;
        assertLe(diff * 1e6, _target(), "raised ~ target");

        (uint256 tokenReserve, uint256 wethReserve) = _reserves();
        assertEq(tokenReserve, curve.poolSupply(), "pool got the other 20%");
        assertEq(wethReserve, raised, "pool got everything raised");
        assertEq(address(curve).balance, _fees(curve), "curve keeps only the fees");
        assertEq(curve.balanceOf(address(curve)), 0, "curve keeps no tokens");

        IPair pair = IPair(curve.pair());
        assertEq(pair.balanceOf(DEAD) + 1000, pair.totalSupply(), "all LP burned (plus Uniswap's minimum)");

        // The pool opens at the curve's last price (to 0.01%).
        uint256 poolPrice = (wethReserve * 1e36) / tokenReserve;
        assertTrue(poolPrice >= lastPrice, "pool price below the curve's");
        uint256 finalCurvePrice = _curvePrice();
        uint256 gap = poolPrice > finalCurvePrice ? poolPrice - finalCurvePrice : finalCurvePrice - poolPrice;
        assertLe(gap * 1e4, finalCurvePrice, "pool price ~ final curve price");
    }

    function test_priceRisesAboutSixteenfold() public {
        uint256 first = _curvePrice();
        uint256 step = _target() / 20;
        uint256 previous = first;
        uint256 last;
        while (!curve.graduated()) {
            last = _curvePrice();
            _buy(bob, step);
            if (!curve.graduated()) {
                assertTrue(_curvePrice() > previous, "price must rise");
                previous = _curvePrice();
            }
        }
        last = _curvePrice();
        // 16x with exact division; within 1% either way for odd numbers.
        assertLe(first * 1584, last * 100, "rise >= 15.84x");
        assertLe(last * 100, first * 1616, "rise <= 16.16x");
    }

    function test_buyingOutRefundsTheOvershoot() public {
        _buy(alice, _target() / 2);
        (uint256 tokens, uint256 cost, uint256 fee) = curve.quoteBuy(10 * _target());
        assertEq(tokens, curve.curveSupply() - curve.tokensSold(), "quote caps at what's left");
        _assertOnePercent(fee, cost, "buy-out fee");
        uint256 before = bob.balance;
        _buy(bob, 10 * _target());
        assertEq(before - bob.balance, cost + fee, "charged the quote and its fee, refunded the rest");
        assertTrue(curve.graduated(), "graduated");
    }

    function test_aBuyerThatRefusesTheRefundCantGraduateIt() public {
        NoEth noEth = new NoEth();
        uint256 tooMuch = 2 * _target();
        vm.prank(alice);
        vm.expectRevert(bytes("Refund failed"));
        noEth.buy{value: tooMuch}(curve);
        assertTrue(!curve.graduated(), "still on the curve");
        // An exact buy needs no refund and works for anyone.
        (, uint256 cost, uint256 fee) = curve.quoteBuy(2 * _target());
        noEth.buy{value: cost + fee}(curve);
        assertTrue(curve.graduated(), "graduated");
    }

    // ── Trading on the curve ───────────────────────────────────────────────

    function test_quotesMatchTrades() public {
        (uint256 quoted, , ) = curve.quoteBuy(_target() / 7);
        uint256 got = _buy(alice, _target() / 7);
        assertEq(got, quoted, "buy matches quote");
        uint256 quotedEth = _sellEth(got / 3);
        uint256 before = alice.balance;
        _sell(alice, got / 3);
        assertEq(alice.balance - before, quotedEth, "sell matches quote");
    }

    function testFuzz_aRoundTripNeverProfits(uint256 seed, uint256 eth) public {
        uint256 head = (seed % _target()) / 2;
        (uint256 headTokens, , ) = curve.quoteBuy(head);
        if (headTokens > 0) _buy(carol, head); // some earlier buying (a few wei buys nothing after the fee)
        eth = 1 + (eth % _target());
        (uint256 tokens, uint256 cost, ) = curve.quoteBuy(eth);
        vm.assume(tokens > 0 && !(curve.tokensSold() + tokens == curve.curveSupply()));
        _buy(alice, eth);
        uint256 back = _sellEth(tokens);
        assertLe(back, cost, "round trip profit");
        if (back > 0) _sell(alice, tokens);
    }

    function testFuzz_everyoneCanSellEverythingBack(uint256 a, uint256 b, uint256 c, uint256 order) public {
        uint256 t = _target();
        uint256[3] memory buys = [1 + (a % (t / 3)), 1 + (b % (t / 3)), 1 + (c % (t / 3))];
        address[3] memory who = [alice, bob, carol];
        uint256 paid;
        uint256 fees;
        for (uint256 i = 0; i < 3; i++) {
            (uint256 tokens, uint256 cost, uint256 fee) = curve.quoteBuy(buys[i]);
            if (tokens == 0) continue;
            _buy(who[i], buys[i]);
            paid += cost;
            fees += fee;
        }
        assertEq(curve.ethReserve(), paid, "reserve = what was paid");
        uint256 returned;
        for (uint256 k = 0; k < 3; k++) {
            uint256 i = ((order % 3) + k) % 3;
            uint256 tokens = curve.balanceOf(who[i]);
            if (tokens == 0) continue;
            (uint256 eth, uint256 fee) = curve.quoteSell(tokens);
            if (eth == 0) continue; // dust worth nothing
            _sell(who[i], tokens);
            returned += eth + fee;
            fees += fee;
        }
        // Early sellers can profit from later buyers, but all together, never.
        assertLe(returned, paid, "paid out more than was paid in");
        assertEq(curve.ethReserve(), paid - returned, "reserve accounting");
        assertEq(_fees(curve), fees, "fee accounting");
        assertEq(address(curve).balance, curve.ethReserve() + _fees(curve), "balance = reserve + fees");
    }

    function test_slippageLimits() public {
        uint256 eth = _target() / 100;
        (uint256 tokens, , ) = curve.quoteBuy(eth);
        _buy(bob, _target() / 4); // someone buys first: price moved
        vm.prank(alice);
        vm.expectRevert(bytes("Price moved: fewer tokens than your minimum"));
        curve.buy{value: eth}(tokens);

        uint256 held = curve.balanceOf(bob);
        uint256 quoted = _sellEth(held / 2);
        _sell(bob, held / 4); // bob sells some first
        vm.prank(bob);
        vm.expectRevert(bytes("Price moved: less ETH than your minimum"));
        curve.sell(held / 2, quoted);
    }

    function test_tinyTradesAreRefusedNotFree() public {
        vm.prank(alice);
        vm.expectRevert(bytes("Send some ETH to buy"));
        curve.buy{value: 0}(0);
        _buy(alice, _target() / 10);
        vm.prank(alice);
        vm.expectRevert(bytes("Nothing to sell"));
        curve.sell(0, 0);
        // One base unit of token is worth less than a wei here.
        if (_sellEth(1) == 0) {
            vm.prank(alice);
            vm.expectRevert(bytes("Too few tokens to get any ETH back"));
            curve.sell(1, 0);
        }
    }

    function test_cantSellMoreThanHeld() public {
        _buy(alice, _target() / 10);
        _buy(bob, _target() / 10);
        uint256 held = curve.balanceOf(alice);
        vm.prank(alice);
        vm.expectRevert(bytes("Insufficient balance"));
        curve.sell(held + 1, 0);
    }

    function test_theLockStopsReentry() public {
        Reenterer r = new Reenterer(curve);
        r.buy{value: _target() / 10}();
        r.sellAll();
        assertTrue(r.reentryFailed(), "re-entered while paying out");
        assertEq(address(curve).balance, curve.ethReserve() + _fees(curve), "balance = reserve + fees");
    }

    // ── Creator buy ────────────────────────────────────────────────────────

    function test_creatorBuyInTheDeployTransaction() public {
        uint256 before = address(this).balance;
        vm.deal(address(this), before + _target());
        ICurve c = _deployCurve(_target() / 10);
        assertTrue(c.balanceOf(address(this)) > 0, "creator got tokens");
        assertEq(c.ethReserve() + _fees(c), _target() / 10, "raised the creator buy, less its fee");
        _assertOnePercent(_fees(c), c.ethReserve(), "creator buy fee");
        assertEq(address(c).balance, c.ethReserve() + _fees(c), "balance = reserve + fees");
        assertTrue(c.creator() == address(this), "the deployer is the creator");
    }

    function test_creatorBuyCantTakeTheWholeCurve() public {
        vm.deal(address(this), 2 * _target());
        bytes memory code = vm.getCode(string.concat(variant(), ".sol:", variant()));
        uint256 value = 2 * _target();
        address deployed;
        assembly {
            deployed := create(value, add(code, 0x20), mload(code))
        }
        assertTrue(deployed == address(0), "deploy should revert");
    }

    receive() external payable {}

    // ── The pool before graduation ─────────────────────────────────────────

    function test_nobodyCanOpenThePoolEarly() public {
        _buy(alice, _target() / 10);
        address pair = curve.pair();
        vm.startPrank(alice);
        vm.expectRevert(bytes("The pool opens when the curve graduates"));
        curve.transfer(pair, 1);
        curve.approve(address(router), type(uint256).max);
        vm.expectRevert();
        router.addLiquidityETH{value: 1 ether}(address(curve), 1e18, 0, 0, alice, block.timestamp);
        curve.approve(bob, type(uint256).max);
        vm.stopPrank();
        vm.prank(bob);
        vm.expectRevert(bytes("The pool opens when the curve graduates"));
        curve.transferFrom(alice, pair, 1);
        // Wallet to wallet is fine.
        vm.prank(alice);
        curve.transfer(bob, 5);
        assertEq(curve.balanceOf(bob), 5, "wallet transfer");
    }

    function test_tokensCantBeSentToTheCurveDirectly() public {
        _buy(alice, _target() / 10);
        vm.prank(alice);
        vm.expectRevert(bytes("Sell to the curve with sell()"));
        curve.transfer(address(curve), 1);
    }

    function test_wethDonatedToThePairJustJoinsThePool() public {
        _buy(alice, _target() / 2);
        address pair = curve.pair();
        // Donate and sync — the pair now has a WETH reserve and no tokens.
        vm.startPrank(bob);
        IWETH9(WETH).deposit{value: 1 ether}();
        IWETH9(WETH).transfer(pair, 0.5 ether);
        IPair(pair).sync();
        IWETH9(WETH).transfer(pair, 0.5 ether); // and some left unsynced
        vm.expectRevert(); // no tokens: nothing to mint against
        IPair(pair).mint(bob);
        vm.stopPrank();

        _buy(carol, 2 * _target());
        assertTrue(curve.graduated(), "graduated anyway");
        (uint256 tokenReserve, uint256 wethReserve) = _reserves();
        assertEq(tokenReserve, curve.poolSupply(), "pool tokens");
        assertEq(wethReserve, curve.ethReserve() + 1 ether, "raised + donation");
        IPair p = IPair(pair);
        assertEq(p.balanceOf(DEAD) + 1000, p.totalSupply(), "all LP burned");
    }

    function test_aPairCreatedBeforeTheDeployIsUsed() public {
        // Someone predicts the next curve's address and creates its pair first.
        Deployer deployer = new Deployer();
        address next = _createAddress(address(deployer), 1); // a contract's first CREATE uses nonce 1
        address early = IFactory(FACTORY).createPair(next, WETH);
        ICurve c = ICurve(deployer.deploy(vm.getCode(string.concat(variant(), ".sol:", variant()))));
        assertTrue(address(c) == next, "address prediction");
        assertTrue(c.pair() == early, "uses the existing pair");
        vm.prank(alice);
        c.buy{value: 2 * c.graduationTarget()}(0);
        assertTrue(c.graduated(), "graduated");
    }

    function _createAddress(address deployer, uint64 nonce) internal pure returns (address) {
        bytes memory rlp;
        if (nonce == 0) rlp = abi.encodePacked(bytes1(0xd6), bytes1(0x94), deployer, bytes1(0x80));
        else if (nonce < 0x80) rlp = abi.encodePacked(bytes1(0xd6), bytes1(0x94), deployer, uint8(nonce));
        else rlp = abi.encodePacked(bytes1(0xd7), bytes1(0x94), deployer, bytes1(0x81), uint8(nonce));
        return address(uint160(uint256(keccak256(rlp))));
    }

    // ── The platform fee ───────────────────────────────────────────────────

    // At least 1% of `amount`, and at most a few wei over it (rounding, per trade).
    function _assertOnePercent(uint256 fee, uint256 amount, string memory what) internal view {
        assertLe(amount * curve.FEE_BPS(), fee * 10000, string.concat(what, ": under 1%"));
        assertLe(fee, (amount * curve.FEE_BPS()) / 10000 + 3, string.concat(what, ": over 1%"));
    }

    // The creator's share of a fee: 30 of its 100 bps, rounded down.
    function _creatorShare(uint256 fee) internal pure returns (uint256) {
        return (fee * 30) / 100;
    }

    function test_theFeeIsFixed_andSplitBetweenThePlatformAndTheCreator() public {
        assertEq(curve.FEE_BPS(), 100, "1%");
        assertEq(curve.CREATOR_FEE_BPS(), 30, "0.3% of it to the creator");
        assertTrue(curve.feeRecipient() == FEE_RECIPIENT, "fee recipient");
        assertTrue(curve.creator() == address(this), "the deployer is the creator");
        assertEq(_fees(curve), 0, "nothing owed yet");
    }

    function testFuzz_everyTradePaysOnePercent_splitSevenToThree(uint256 eth, uint256 share) public {
        eth = 1000 + (eth % (_target() / 2));
        (uint256 tokens, uint256 cost, uint256 fee) = curve.quoteBuy(eth);
        vm.assume(tokens > 0);
        assertEq(cost + fee, eth, "a buy below the cap spends all it was sent");
        _assertOnePercent(fee, cost, "buy fee");
        uint256 before = alice.balance;
        _buy(alice, eth);
        assertEq(before - alice.balance, eth, "buyer paid what was sent");
        assertEq(curve.ethReserve(), cost, "only the cost joined the reserve");
        assertEq(curve.creatorFeesOwed(), _creatorShare(fee), "creator's 30%");
        assertEq(curve.feesOwed(), fee - _creatorShare(fee), "platform's 70%, and the rounding");

        uint256 selling = (tokens * (1 + (share % 100))) / 100;
        (uint256 back, uint256 sellFee) = curve.quoteSell(selling);
        vm.assume(back > 0);
        _assertOnePercent(sellFee, back + sellFee, "sell fee");
        before = alice.balance;
        _sell(alice, selling);
        assertEq(alice.balance - before, back, "seller got the quote, less the fee");
        assertEq(curve.ethReserve(), cost - back - sellFee, "the reserve paid the sale and its fee");
        assertEq(curve.creatorFeesOwed(), _creatorShare(fee) + _creatorShare(sellFee), "creator's share of both");
        assertEq(_fees(curve), fee + sellFee, "both fees owed, nothing lost to the split");
        assertEq(address(curve).balance, curve.ethReserve() + _fees(curve), "balance = reserve + fees");
    }

    function test_eachShareGoesOnlyToItsOwner_andAnyoneCanSendIt() public {
        vm.prank(alice);
        vm.expectRevert(bytes("No fees to withdraw"));
        curve.withdrawFees();
        vm.prank(alice);
        vm.expectRevert(bytes("No creator fees to claim"));
        curve.claimCreatorFees();

        _buy(alice, _target() / 5);
        _sell(alice, curve.balanceOf(alice) / 2);
        uint256 platform = curve.feesOwed();
        uint256 creatorShare = curve.creatorFeesOwed();
        uint256 reserve = curve.ethReserve();
        uint256 bobBefore = bob.balance;
        uint256 creatorBefore = address(this).balance;
        vm.prank(bob); // neither the platform nor the creator: pays only the platform
        assertEq(curve.withdrawFees(), platform, "withdrew the platform's share");
        assertEq(FEE_RECIPIENT.balance, platform, "platform got its share");
        assertEq(curve.creatorFeesOwed(), creatorShare, "the creator's share stays the creator's");
        vm.prank(bob); // pays only the creator
        assertEq(curve.claimCreatorFees(), creatorShare, "claimed the creator's share");
        assertEq(address(this).balance - creatorBefore, creatorShare, "creator got its share");
        assertEq(bob.balance, bobBefore, "the caller got nothing");
        assertEq(_fees(curve), 0, "nothing owed");
        assertEq(curve.ethReserve(), reserve, "the reserve is untouched");
        assertEq(address(curve).balance, reserve, "balance = reserve");
        // Sellers can still all be paid.
        _sell(alice, curve.balanceOf(alice));
    }

    function test_feesOutliveGraduation() public {
        _buy(alice, _target() / 3);
        _buy(bob, 2 * _target());
        assertTrue(curve.graduated(), "graduated");
        (, uint256 wethReserve) = _reserves();
        assertEq(wethReserve, curve.ethReserve(), "the pool got the raise, not the fees");
        uint256 platform = curve.feesOwed();
        uint256 creatorShare = curve.creatorFeesOwed();
        assertTrue(platform > 0 && creatorShare > 0, "fees owed");
        uint256 creatorBefore = address(this).balance;
        curve.withdrawFees();
        curve.claimCreatorFees();
        assertEq(FEE_RECIPIENT.balance, platform, "platform got its share");
        assertEq(address(this).balance - creatorBefore, creatorShare, "creator got its share");
        assertEq(address(curve).balance, 0, "curve keeps no ETH");
    }

    function test_aFeeWalletThatRefusesEthCantStopTradingOrTheCreator() public {
        vm.etch(FEE_RECIPIENT, hex"fe"); // reverts on any call
        _buy(alice, _target() / 5);
        _sell(alice, curve.balanceOf(alice) / 2);
        vm.expectRevert(bytes("Fee transfer failed"));
        curve.withdrawFees();
        curve.claimCreatorFees();
        assertEq(curve.creatorFeesOwed(), 0, "the creator was paid anyway");
        _buy(bob, 2 * _target());
        assertTrue(curve.graduated(), "graduated anyway");
    }

    function test_aCreatorThatRefusesEthCantStopTradingOrThePlatform() public {
        // Launched by a contract that takes no ETH.
        Deployer deployer = new Deployer();
        ICurve c = ICurve(deployer.deploy(vm.getCode(string.concat(variant(), ".sol:", variant()))));
        assertTrue(c.creator() == address(deployer), "creator");
        vm.prank(alice);
        c.buy{value: c.graduationTarget() / 5}(0);
        vm.expectRevert(bytes("Creator fee transfer failed"));
        c.claimCreatorFees();
        uint256 platform = c.feesOwed();
        c.withdrawFees();
        assertEq(FEE_RECIPIENT.balance, platform, "the platform was paid anyway");
        vm.prank(bob);
        c.buy{value: 2 * c.graduationTarget()}(0);
        assertTrue(c.graduated(), "graduated anyway");
    }

    // ── After graduation ───────────────────────────────────────────────────

    function test_afterGraduationItTradesOnTheDexOnly() public {
        _buy(alice, 2 * _target());
        assertTrue(curve.graduated(), "graduated");

        vm.prank(bob);
        vm.expectRevert(bytes("The curve has graduated: trade on the DEX"));
        curve.buy{value: 1}(0);
        vm.prank(alice);
        vm.expectRevert(bytes("The curve has graduated: trade on the DEX"));
        curve.sell(1, 0);
        (uint256 tokens, , ) = curve.quoteBuy(1 ether);
        assertEq(tokens, 0, "no quotes after graduation");

        address[] memory path = new address[](2);
        path[0] = WETH;
        path[1] = address(curve);
        vm.prank(bob);
        router.swapExactETHForTokens{value: _target() / 100}(0, path, bob, block.timestamp);
        assertTrue(curve.balanceOf(bob) > 0, "bought on the DEX");

        path[0] = address(curve);
        path[1] = WETH;
        uint256 sellAmount = curve.balanceOf(alice) / 10;
        uint256 before = alice.balance;
        vm.startPrank(alice);
        curve.approve(address(router), sellAmount);
        router.swapExactTokensForETH(sellAmount, 0, path, alice, block.timestamp);
        vm.stopPrank();
        assertTrue(alice.balance > before, "sold on the DEX");
    }
}

contract CurveDefaultTest is CurveTest {
    function variant() internal pure override returns (string memory) {
        return "CurveDefault";
    }
}

contract CurveSmallTest is CurveTest {
    function variant() internal pure override returns (string memory) {
        return "CurveSmall";
    }
}

contract CurveHugeTest is CurveTest {
    function variant() internal pure override returns (string memory) {
        return "CurveHuge";
    }
}

contract CurveOddTest is CurveTest {
    function variant() internal pure override returns (string memory) {
        return "CurveOdd";
    }
}

// ── Invariants: random buys, sells and transfers by several wallets ─────────

contract Handler {
    ICurve public curve;
    address[4] actors = [address(0x1001), address(0x1002), address(0x1003), address(0x1004)];
    uint256 public netPaid; // ETH paid in minus ETH paid out, on the curve
    uint256 public feesCharged;
    uint256 public creatorFeesCharged;
    uint256 public feesWithdrawn;
    uint256 public creatorFeesClaimed;
    uint256 public calls;

    constructor(ICurve curve_) {
        curve = curve_;
        for (uint256 i = 0; i < 4; i++) vm.deal(actors[i], 1e30);
    }

    function buy(uint256 who, uint256 eth) external {
        if (curve.graduated()) return;
        uint256 target = curve.graduationTarget();
        // Mostly small buys, now and then a big one that may graduate it.
        eth = (eth % 10 == 0) ? 1 + (eth % (2 * target)) : 1 + (eth % (target / 20));
        (uint256 tokens, uint256 cost, uint256 fee) = curve.quoteBuy(eth);
        if (tokens == 0) return;
        vm.prank(actors[who % 4]);
        curve.buy{value: eth}(0);
        netPaid += cost;
        feesCharged += fee;
        creatorFeesCharged += (fee * 30) / 100;
        calls++;
    }

    function sell(uint256 who, uint256 share) external {
        if (curve.graduated()) return;
        address actor = actors[who % 4];
        uint256 tokens = (curve.balanceOf(actor) * (1 + (share % 100))) / 100;
        (uint256 eth, uint256 fee) = curve.quoteSell(tokens);
        if (eth == 0) return;
        vm.prank(actor);
        curve.sell(tokens, 0);
        netPaid -= eth + fee;
        feesCharged += fee;
        creatorFeesCharged += (fee * 30) / 100;
        calls++;
    }

    function withdrawFees(uint256 who) external {
        if (curve.feesOwed() == 0) return;
        vm.prank(actors[who % 4]);
        feesWithdrawn += curve.withdrawFees();
    }

    function claimCreatorFees(uint256 who) external {
        if (curve.creatorFeesOwed() == 0) return;
        vm.prank(actors[who % 4]);
        creatorFeesClaimed += curve.claimCreatorFees();
    }

    function transfer(uint256 from, uint256 to, uint256 share) external {
        address a = actors[from % 4];
        uint256 tokens = (curve.balanceOf(a) * (share % 101)) / 100;
        vm.prank(a);
        curve.transfer(actors[to % 4], tokens);
    }

    function holdersBalance() external view returns (uint256 total) {
        for (uint256 i = 0; i < 4; i++) total += curve.balanceOf(actors[i]);
    }
}

abstract contract CurveInvariants is WithUniswap {
    ICurve curve;
    Handler handler;
    uint256 startBalance; // forge starts a test contract with a large balance

    function variant() internal pure virtual returns (string memory);

    function setUp() public {
        _deployUniswap();
        curve = ICurve(_create(vm.getCode(string.concat(variant(), ".sol:", variant())), 0));
        handler = new Handler(curve);
        startBalance = address(this).balance;
    }

    receive() external payable {} // the creator: it launched the curve

    function targetContracts() public view returns (address[] memory targets) {
        targets = new address[](1);
        targets[0] = address(handler);
    }

    function invariant_theCurveCanAlwaysPayEverySeller() public view {
        if (curve.graduated()) return;
        assertEq(address(curve).balance, curve.ethReserve() + curve.feesOwed() + curve.creatorFeesOwed(), "balance = reserve + fees");
        assertEq(curve.ethReserve(), handler.netPaid(), "reserve = net paid in");
        // Selling every token in circulation at once (and its fee) takes at most the reserve.
        (uint256 eth, uint256 fee) = curve.quoteSell(curve.tokensSold());
        assertLe(eth + fee, curve.ethReserve(), "reserve covers a full sell-back");
        // Rounding favours the curve: the reserves' product never drops below k.
        uint256 k = curve.virtualEth() * curve.virtualTokens();
        uint256 product = (curve.virtualEth() + curve.ethReserve()) * (curve.virtualTokens() - curve.tokensSold());
        assertTrue(product >= k, "reserve product fell below k");
    }

    function invariant_tokensAreAccountedFor() public view {
        if (curve.graduated()) {
            assertEq(curve.balanceOf(address(curve)), 0, "curve empty after graduation");
            assertEq(address(curve).balance, curve.feesOwed() + curve.creatorFeesOwed(), "only fees left after graduation");
            return;
        }
        assertEq(curve.balanceOf(address(curve)) + curve.tokensSold(), curve.totalSupply(), "held + sold = supply");
        assertEq(handler.holdersBalance(), curve.tokensSold(), "holders hold what was sold");
        assertLe(curve.tokensSold(), curve.curveSupply(), "never more than the curve sells");
    }

    function invariant_feesAreOwedOrPaid_eachShareToItsOwnerOnly() public view {
        // Every fee charged is the creator's 30% (rounded down) or the platform's rest.
        assertEq(curve.creatorFeesOwed() + handler.creatorFeesClaimed(), handler.creatorFeesCharged(), "creator: charged = owed + claimed");
        assertEq(
            curve.feesOwed() + handler.feesWithdrawn(),
            handler.feesCharged() - handler.creatorFeesCharged(),
            "platform: charged = owed + withdrawn"
        );
        assertEq(FEE_RECIPIENT.balance, handler.feesWithdrawn(), "withdrawn fees reached the platform");
        assertEq(address(this).balance - startBalance, handler.creatorFeesClaimed(), "claimed fees reached the creator");
    }

    function invariant_afterGraduationThePoolHasEverything() public view {
        if (!curve.graduated()) return;
        IPair pair = IPair(curve.pair());
        assertEq(curve.balanceOf(address(pair)), curve.poolSupply(), "pool tokens");
        assertEq(IWETH9(WETH).balanceOf(address(pair)), curve.ethReserve(), "pool WETH");
        assertEq(pair.balanceOf(DEAD) + 1000, pair.totalSupply(), "LP burned");
    }
}

contract CurveDefaultInvariants is CurveInvariants {
    function variant() internal pure override returns (string memory) {
        return "CurveDefault";
    }
}

contract CurveOddInvariants is CurveInvariants {
    function variant() internal pure override returns (string memory) {
        return "CurveOdd";
    }
}

contract CurveSmallInvariants is CurveInvariants {
    function variant() internal pure override returns (string memory) {
        return "CurveSmall";
    }
}
