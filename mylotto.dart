import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'dart:convert';

import 'home.dart';
import 'setting.dart';
import 'model/login_model.dart';
import 'config.dart';

class MyLottoPage extends StatefulWidget {
  final Customer customer;
  const MyLottoPage({super.key, required this.customer});

  @override
  State<MyLottoPage> createState() => _MyLottoPageState();
}

class _MyLottoPageState extends State<MyLottoPage> {
  List<dynamic> myLotto = [];
  bool isLoading = true;

  Map<int, List<dynamic>> prizeByRound = {};

  final TextEditingController _searchController = TextEditingController();
  String _searchText = '';

  @override
  void initState() {
    super.initState();
    fetchMyLotto();
  }

  Future<void> fetchMyLotto() async {
    final url = Uri.parse(
      "${AppConfig.apiEndpoint}/my-lotto/${widget.customer.cusId}",
    );
    try {
      final response = await http.get(url);
      if (response.statusCode == 200) {
        final data = json.decode(response.body);
        setState(() {
          myLotto = data["myLotto"];
          isLoading = false;
        });
        // ดึงรางวัลของทุกงวดที่ซื้อ
        final rounds = myLotto.map((e) => e["round"]).toSet();
        for (final r in rounds) {
          fetchPrize(r);
        }
      } else {
        throw Exception("โหลดข้อมูลไม่สำเร็จ");
      }
    } catch (e) {
      setState(() {
        isLoading = false;
      });
      print("Error: $e");
    }
  }

  // ดึงรางวัลแต่ละงวด
  Future<void> fetchPrize(int round) async {
    if (prizeByRound.containsKey(round)) return;
    final url = Uri.parse("${AppConfig.apiEndpoint}/prize/$round");
    try {
      final response = await http.get(url);
      if (response.statusCode == 200) {
        final data = json.decode(response.body);
        setState(() {
          prizeByRound[round] = data["prizes"];
        });
      }
    } catch (e) {
      //
    }
  }

  // ฟังก์ชันตรวจสอบรางวัล
  Map<String, dynamic>? checkPrize(int round, String number) {
    final prizes = prizeByRound[round] ?? [];
    for (final prize in prizes) {
      if (prize["number"] == number) {
        return prize;
      }
    }
    return null;
  }

  Future<void> redeemPrize(int purchaseId) async {
    final url = Uri.parse("${AppConfig.apiEndpoint}/redeem/$purchaseId");
    try {
      final response = await http.post(url);
      if (response.statusCode == 200) {
        final data = json.decode(response.body);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(data["message"] ?? "ขึ้นเงินสำเร็จ")),
        );
        fetchMyLotto(); // โหลดข้อมูลใหม่
      } else {
        final err = json.decode(response.body);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(err["message"] ?? "ไม่สามารถขึ้นเงินได้")),
        );
      }
    } catch (e) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text("เกิดข้อผิดพลาด: $e")));
    }
  }

  List<dynamic> get filteredLotto {
    if (_searchText.isEmpty) return myLotto;
    return myLotto.where((lotto) {
      final number = lotto["number"]?.toString() ?? '';
      return number.contains(_searchText);
    }).toList();
  }

  @override
  Widget build(BuildContext context) {
    double walletBalance = widget.customer.walletBalance;

    return Scaffold(
      appBar: AppBar(
        title: Text('My Lotto - ${widget.customer.fullname}'),
        backgroundColor: const Color(0xFF001E46),
      ),
      body: Column(
        children: [
          // Search bar
          Padding(
            padding: const EdgeInsets.all(16.0),
            child: Row(
              children: [
                Expanded(
                  flex: 3,
                  child: TextField(
                    controller: _searchController,
                    decoration: InputDecoration(
                      hintText: 'ค้นหาล็อตเตอรี่',
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(8),
                      ),
                      prefixIcon: const Icon(Icons.search),
                      suffixIcon: _searchController.text.isNotEmpty
                          ? IconButton(
                              icon: const Icon(Icons.clear),
                              onPressed: () {
                                setState(() {
                                  _searchController.clear();
                                  _searchText = '';
                                });
                              },
                            )
                          : null,
                    ),
                    onChanged: (value) {
                      setState(() {});
                    },
                  ),
                ),
                const SizedBox(width: 8),
                Flexible(
                  flex: 1,
                  child: ElevatedButton(
                    onPressed: () {
                      setState(() {
                        _searchText = _searchController.text.trim();
                      });
                    },
                    style: ElevatedButton.styleFrom(
                      backgroundColor: const Color(0xFF001E46),
                      minimumSize: const Size(double.infinity, 48),
                    ),
                    child: const Text(
                      'ค้นหา',
                      style: TextStyle(
                        fontWeight: FontWeight.bold,
                        color: Colors.white,
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
          // My Wallet
          Padding(
            padding: const EdgeInsets.only(left: 16.0, top: 0, bottom: 8.0),
            child: Row(
              children: [
                const Text(
                  "My Wallet: ",
                  style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
                ),
                Text(
                  "฿${walletBalance.toStringAsFixed(2)}",
                  style: const TextStyle(
                    color: Colors.green,
                    fontWeight: FontWeight.bold,
                    fontSize: 16,
                  ),
                ),
              ],
            ),
          ),

          // My Lotto List
          Expanded(
            child: isLoading
                ? const Center(child: CircularProgressIndicator())
                : filteredLotto.isEmpty
                ? const Center(child: Text("ยังไม่มีการซื้อ"))
                : ListView.builder(
                    itemCount: filteredLotto.length,
                    itemBuilder: (context, index) {
                      final lotto = filteredLotto[index];
                      final number = lotto["number"].toString();
                      final round = lotto["round"];
                      final purchaseDate = lotto["purchase_date"];
                      final claimed = lotto["is_redeemed"] == 1;

                      final prize = checkPrize(round, number);

                      Color cardColor = Colors.white;
                      String prizeText = "ไม่ถูกรางวัล";
                      Color prizeTextColor = Colors.red;
                      String prizeTypeText = "";
                      if (prize != null) {
                        cardColor = Colors.green[50]!;
                        prizeText = "ถูก${prize["prize_type"]}";
                        prizeTextColor = Colors.green;
                        prizeTypeText = "${prize["reward_amount"]} บาท";
                      }

                      return Card(
                        color: cardColor,
                        margin: const EdgeInsets.symmetric(
                          vertical: 8,
                          horizontal: 16,
                        ),
                        child: Padding(
                          padding: const EdgeInsets.all(16.0),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(
                                children: [
                                  Expanded(
                                    child: Text(
                                      "ฉลากกินแบ่ง: $number",
                                      style: const TextStyle(fontSize: 18),
                                    ),
                                  ),
                                  Text(
                                    "งวดที่: $round",
                                    style: const TextStyle(
                                      fontWeight: FontWeight.bold,
                                      color: Colors.black54,
                                    ),
                                  ),
                                ],
                              ),
                              const SizedBox(height: 4),
                              Text(
                                "วันที่ซื้อ: $purchaseDate",
                                style: const TextStyle(color: Colors.black54),
                              ),
                              const SizedBox(height: 8),
                              Row(
                                children: [
                                  Expanded(
                                    child: Column(
                                      crossAxisAlignment:
                                          CrossAxisAlignment.start,
                                      children: [
                                        Text(
                                          prizeText,
                                          style: TextStyle(
                                            color: prizeTextColor,
                                            fontWeight: FontWeight.bold,
                                            fontSize: 16,
                                          ),
                                        ),
                                        if (prizeTypeText.isNotEmpty)
                                          Text(
                                            prizeTypeText,
                                            style: const TextStyle(
                                              color: Colors.black,
                                              fontWeight: FontWeight.bold,
                                            ),
                                          ),
                                      ],
                                    ),
                                  ),
                                  const SizedBox(width: 8),
                                  claimed
                                      ? ElevatedButton(
                                          onPressed: null,
                                          style: ElevatedButton.styleFrom(
                                            backgroundColor: Colors.grey,
                                          ),
                                          child: const Text('ได้รับแล้ว'),
                                        )
                                      : prize != null
                                      ? ElevatedButton(
                                          onPressed: () {
                                            redeemPrize(lotto["purchase_id"]);
                                          },
                                          style: ElevatedButton.styleFrom(
                                            backgroundColor: Colors.green,
                                          ),
                                          child: const Text(
                                            'ขึ้นเงินรางวัล',
                                            style: TextStyle(
                                              color: Colors.white,
                                            ),
                                          ),
                                        )
                                      : Container(),
                                ],
                              ),
                            ],
                          ),
                        ),
                      );
                    },
                  ),
          ),

          _footer(context),
        ],
      ),
    );
  }

  Widget _footer(BuildContext context) {
    return Container(
      height: 70,
      color: const Color(0xFFF1F7F8),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceAround,
        children: [
          InkWell(
            onTap: () {
              Navigator.pushReplacement(
                context,
                MaterialPageRoute(
                  builder: (_) => HomePage(customer: widget.customer),
                ),
              );
            },
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: const [
                Icon(Icons.home, color: Colors.grey),
                SizedBox(height: 4),
                Text(
                  'Home',
                  style: TextStyle(color: Colors.grey, fontSize: 12),
                ),
              ],
            ),
          ),
          InkWell(
            onTap: () {},
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: const [
                Icon(Icons.confirmation_number, color: Colors.blue),
                SizedBox(height: 4),
                Text(
                  'MyLotto',
                  style: TextStyle(color: Colors.blue, fontSize: 12),
                ),
              ],
            ),
          ),
          InkWell(
            onTap: () {
              Navigator.pushReplacement(
                context,
                MaterialPageRoute(
                  builder: (_) => SettingPage(customer: widget.customer),
                ),
              );
            },
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: const [
                Icon(Icons.person, color: Colors.grey),
                SizedBox(height: 4),
                Text(
                  'Setting',
                  style: TextStyle(color: Colors.grey, fontSize: 12),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
