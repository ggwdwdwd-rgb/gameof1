package com.gameof1.ui

import android.graphics.Color
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.Toast
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.gameof1.databinding.BottomSheetUpgradeBinding
import com.gameof1.databinding.ItemUpgradeBinding
import com.gameof1.game.GameEngine
import com.gameof1.game.Upgrade
import com.google.android.material.bottomsheet.BottomSheetDialogFragment

class UpgradeBottomSheet(
    private val engine: GameEngine,
    private val onPurchased: () -> Unit
) : BottomSheetDialogFragment() {

    companion object {
        const val TAG = "UpgradeBottomSheet"
    }

    private var _binding: BottomSheetUpgradeBinding? = null
    private val binding get() = _binding!!
    private var adapter: UpgradeAdapter? = null

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View {
        _binding = BottomSheetUpgradeBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        binding.rvUpgrades.layoutManager = LinearLayoutManager(context)
        refreshList()
        binding.rvUpgrades.adapter = adapter
    }

    private fun refreshList() {
        binding.tvDnaBalance.text = "${engine.pathogen.dnaPoints} ДНК"
        val unlockedIds = engine.pathogen.upgrades.filter { it.unlocked }.map { it.id }.toSet()
        if (adapter == null) {
            adapter = UpgradeAdapter(engine.pathogen.upgrades, unlockedIds) { upgrade -> onBuy(upgrade) }
        } else {
            adapter!!.update(unlockedIds)
        }
    }

    private fun onBuy(upgrade: Upgrade) {
        if (engine.pathogen.purchaseUpgrade(upgrade.id)) {
            onPurchased()
            Toast.makeText(context, "✅ ${upgrade.name} разблокировано!", Toast.LENGTH_SHORT).show()
            refreshList()
        } else {
            Toast.makeText(context, "❌ Недостаточно ДНК или требования не выполнены", Toast.LENGTH_SHORT).show()
        }
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }
}

class UpgradeAdapter(
    private val upgrades: List<Upgrade>,
    private var unlockedIds: Set<String>,
    private val onBuy: (Upgrade) -> Unit
) : RecyclerView.Adapter<UpgradeAdapter.VH>() {

    inner class VH(val binding: ItemUpgradeBinding) : RecyclerView.ViewHolder(binding.root)

    fun update(newUnlockedIds: Set<String>) {
        unlockedIds = newUnlockedIds
        notifyDataSetChanged()
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): VH =
        VH(ItemUpgradeBinding.inflate(LayoutInflater.from(parent.context), parent, false))

    override fun getItemCount() = upgrades.size

    override fun onBindViewHolder(holder: VH, position: Int) {
        val u = upgrades[position]; val b = holder.binding

        b.tvUpgradeIcon.text = u.icon
        b.tvUpgradeName.text = u.name
        b.tvUpgradeDesc.text = u.description
        b.tvUpgradeCost.text = "${u.cost} ДНК"
        b.tvCategory.text = u.category.displayName

        // Цветная полоска по категории
        b.categoryStrip.setBackgroundColor(when (u.category) {
            Upgrade.Category.TRANSMISSION -> Color.parseColor("#44AAFF")
            Upgrade.Category.SEVERITY     -> Color.parseColor("#FF6600")
            Upgrade.Category.ABILITY      -> Color.parseColor("#AA44FF")
        })

        val requiresMet = u.requires.all { it in unlockedIds }
        when {
            u.unlocked -> {
                b.btnBuy.text = "✓ Куплено"
                b.btnBuy.isEnabled = false
                b.root.alpha = 0.55f
            }
            !requiresMet -> {
                b.btnBuy.text = "🔒 Заблок."
                b.btnBuy.isEnabled = false
                b.root.alpha = 0.45f
            }
            else -> {
                b.btnBuy.text = "Купить"
                b.btnBuy.isEnabled = true
                b.root.alpha = 1.0f
                b.btnBuy.setOnClickListener { onBuy(u) }
            }
        }
    }
}
