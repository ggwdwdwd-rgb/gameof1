package com.gameof1.ui

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

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View {
        _binding = BottomSheetUpgradeBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        binding.tvDnaBalance.text = "Доступно: ${engine.pathogen.dnaPoints} DNA"

        val allUpgrades = engine.pathogen.upgrades
        val unlockedIds = allUpgrades.filter { it.unlocked }.map { it.id }.toSet()

        val adapter = UpgradeAdapter(allUpgrades, unlockedIds) { upgrade ->
            if (engine.pathogen.purchaseUpgrade(upgrade.id)) {
                binding.tvDnaBalance.text = "Доступно: ${engine.pathogen.dnaPoints} DNA"
                onPurchased()
                Toast.makeText(context, "${upgrade.name} разблокировано!", Toast.LENGTH_SHORT).show()
                dismiss()
            } else {
                Toast.makeText(context, "Недостаточно DNA или требования не выполнены", Toast.LENGTH_SHORT).show()
            }
        }

        binding.rvUpgrades.layoutManager = LinearLayoutManager(context)
        binding.rvUpgrades.adapter = adapter
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }
}

class UpgradeAdapter(
    private val upgrades: List<Upgrade>,
    private val unlockedIds: Set<String>,
    private val onBuy: (Upgrade) -> Unit
) : RecyclerView.Adapter<UpgradeAdapter.VH>() {

    inner class VH(val binding: ItemUpgradeBinding) : RecyclerView.ViewHolder(binding.root)

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): VH {
        val b = ItemUpgradeBinding.inflate(LayoutInflater.from(parent.context), parent, false)
        return VH(b)
    }

    override fun getItemCount() = upgrades.size

    override fun onBindViewHolder(holder: VH, position: Int) {
        val upgrade = upgrades[position]
        val b = holder.binding

        b.tvUpgradeIcon.text = upgrade.icon
        b.tvUpgradeName.text = upgrade.name
        b.tvUpgradeDesc.text = upgrade.description
        b.tvUpgradeCost.text = "${upgrade.cost} DNA"
        b.tvCategory.text = upgrade.category.displayName

        val requiresMet = upgrade.requires.all { it in unlockedIds }

        when {
            upgrade.unlocked -> {
                b.btnBuy.text = "Куплено"
                b.btnBuy.isEnabled = false
                b.root.alpha = 0.6f
            }
            !requiresMet -> {
                b.btnBuy.text = "Заблок."
                b.btnBuy.isEnabled = false
                b.root.alpha = 0.5f
            }
            else -> {
                b.btnBuy.text = "Купить"
                b.btnBuy.isEnabled = true
                b.root.alpha = 1.0f
                b.btnBuy.setOnClickListener { onBuy(upgrade) }
            }
        }
    }
}
